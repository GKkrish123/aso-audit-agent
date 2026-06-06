"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArchiveX,
  ArrowUp,
  Bot,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MetadataConfirmCard } from "@/components/audit/metadata-confirm-card";
import { AuditProgress } from "@/components/audit/audit-progress";
import { AuditResults } from "@/components/audit/audit-results";
import { isLikelyAppStoreUrl } from "@/lib/security/url-guard";
import { cn } from "@/lib/utils";
import type { AuditJob } from "@/types/audit";
import { setSidebarOpen, useSidebarOpen } from "./sidebar-store";

type ChatMessage =
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "agent"; kind: "text"; text: string }
  | { id: string; role: "agent"; kind: "confirm"; jobId: string }
  | { id: string; role: "agent"; kind: "progress"; jobId: string }
  | { id: string; role: "agent"; kind: "result"; jobId: string }
  | { id: string; role: "agent"; kind: "error"; text: string };

interface ChatRecord {
  chatId: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  job: AuditJob | null;
}

interface ChatsPageResponse {
  chats: ChatRecord[];
  nextCursor: string | null;
}

const ACTIVE_CHAT_KEY = "aso-audit-active-chat";
const WELCOME_MESSAGE =
  "Paste an Apple App Store URL and I'll run a full ASO audit. I'll confirm the app with you first, then score 10 dimensions and produce a prioritized recommendation list with before/after copy.";

const TERMINAL: AuditJob["status"][] = ["completed", "failed", "cancelled"];

function isTerminal(s: AuditJob["status"]): boolean {
  return TERMINAL.includes(s);
}

/** Poll only while the server is actively working — not while waiting for user confirm. */
function shouldPollJobStatus(s: AuditJob["status"]): boolean {
  return s === "queued" || s === "fetching_metadata" || s === "running_audit";
}

function appendProgressMessage(messages: ChatMessage[], jobId: string): ChatMessage[] {
  if (messages.some((m) => "jobId" in m && m.jobId === jobId && m.kind === "progress")) {
    return messages;
  }
  return [
    ...messages,
    { id: `prog-${jobId}`, role: "agent", kind: "progress", jobId },
  ];
}

function removeProgressMessage(messages: ChatMessage[], jobId: string): ChatMessage[] {
  return messages.filter(
    (m) => !("jobId" in m && m.jobId === jobId && m.kind === "progress"),
  );
}

export function AuditChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);
  const [archivedChats, setArchivedChats] = useState<ChatRecord[]>([]);
  const [archivedNextCursor, setArchivedNextCursor] = useState<string | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedLoadedOnce, setArchivedLoadedOnce] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(true);
  const [switchingChat, setSwitchingChat] = useState(false);
  const [activeJob, setActiveJob] = useState<AuditJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const sidebarOpen = useSidebarOpen();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadChatRequestRef = useRef(0);
  const activeChatIdRef = useRef<string | null>(null);
  const switchingChatRef = useRef(false);
  const confirmInFlightRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollGenRef = useRef(0);
  const activeJobRef = useRef<AuditJob | null>(null);
  activeJobRef.current = activeJob;
  activeChatIdRef.current = activeChatId;
  switchingChatRef.current = switchingChat;

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const closeSidebarOnMobile = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 767px)").matches) {
      setSidebarOpen(false);
    }
  }, []);

  const makeWelcome = useCallback(
    (): ChatMessage[] => [
      {
        id: "welcome",
        role: "agent",
        kind: "text",
        text: WELCOME_MESSAGE,
      },
    ],
    [],
  );

  const fetchChats = useCallback(
    async (opts?: { cursor?: string; archivedOnly?: boolean }): Promise<ChatsPageResponse> => {
      const params = new URLSearchParams();
      params.set("limit", "12");
      if (opts?.cursor) params.set("cursor", opts.cursor);
      if (opts?.archivedOnly) params.set("archivedOnly", "true");
      const res = await fetch(`/api/chats?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load chats");
      return (await res.json()) as ChatsPageResponse;
    },
    [],
  );

  const refreshChats = useCallback(async () => {
    try {
      const page = await fetchChats();
      setChats(page.chats);
      setNextCursor(page.nextCursor);
    } catch {
    }
  }, [fetchChats]);

  const refreshArchivedChats = useCallback(async () => {
    setArchivedLoading(true);
    try {
      const page = await fetchChats({ archivedOnly: true });
      setArchivedChats(page.chats);
      setArchivedNextCursor(page.nextCursor);
      setArchivedLoadedOnce(true);
    } catch {
    } finally {
      setArchivedLoading(false);
    }
  }, [fetchChats]);

  const loadMoreChats = useCallback(async () => {
    if (!nextCursor || loadingMoreChats) return;
    setLoadingMoreChats(true);
    try {
      const page = await fetchChats({ cursor: nextCursor });
      setChats((prev) => {
        const seen = new Set(prev.map((c) => c.chatId));
        const merged = [...prev];
        for (const chat of page.chats) {
          if (!seen.has(chat.chatId)) merged.push(chat);
        }
        return merged;
      });
      setNextCursor(page.nextCursor);
    } catch {
      toast.error("Could not load more chats");
    } finally {
      setLoadingMoreChats(false);
    }
  }, [fetchChats, loadingMoreChats, nextCursor]);

  const loadMoreArchivedChats = useCallback(async () => {
    if (!archivedNextCursor || archivedLoading) return;
    setArchivedLoading(true);
    try {
      const page = await fetchChats({ cursor: archivedNextCursor, archivedOnly: true });
      setArchivedChats((prev) => {
        const seen = new Set(prev.map((c) => c.chatId));
        const merged = [...prev];
        for (const chat of page.chats) {
          if (!seen.has(chat.chatId)) merged.push(chat);
        }
        return merged;
      });
      setArchivedNextCursor(page.nextCursor);
    } catch {
      toast.error("Could not load more archived chats");
    } finally {
      setArchivedLoading(false);
    }
  }, [archivedLoading, archivedNextCursor, fetchChats]);

  const toggleArchivedOpen = useCallback(() => {
    setArchivedOpen((open) => {
      const next = !open;
      if (next && !archivedLoadedOnce) {
        void refreshArchivedChats();
      }
      return next;
    });
  }, [archivedLoadedOnce, refreshArchivedChats]);

  const rehydrateFromJob = useCallback((job: AuditJob) => {
    setActiveJob(job);
    const base = makeWelcome();
    base.push({ id: `user-${job.jobId}`, role: "user", kind: "text", text: job.inputUrl });
    if (job.metadata) {
      base.push({ id: `confirm-${job.jobId}`, role: "agent", kind: "confirm", jobId: job.jobId });
    }
    if (job.status === "running_audit") {
      base.push({ id: `prog-${job.jobId}`, role: "agent", kind: "progress", jobId: job.jobId });
    }
    if (job.status === "completed" && job.report) {
      base.push({ id: `result-${job.jobId}`, role: "agent", kind: "result", jobId: job.jobId });
    }
    if (job.status === "failed") {
      base.push({
        id: `err-${job.jobId}`,
        role: "agent",
        kind: "error",
        text: job.error ?? "The audit failed. Please try again.",
      });
    }
    setMessages(base);
  }, [makeWelcome]);

  const applyJobTransition = useCallback((job: AuditJob) => {
    setMessages((prev) => {
      const next = [...prev];
      const has = (kind: string, id: string) =>
        next.some((m) => "jobId" in m && m.jobId === id && m.kind === kind);

      if (job.metadata && !has("confirm", job.jobId)) {
        next.push({ id: `confirm-${job.jobId}`, role: "agent", kind: "confirm", jobId: job.jobId });
      }
      if (job.status === "running_audit" && !has("progress", job.jobId)) {
        next.push({ id: `prog-${job.jobId}`, role: "agent", kind: "progress", jobId: job.jobId });
      }
      if (job.status === "completed" && job.report && !has("result", job.jobId)) {
        next.push({ id: `result-${job.jobId}`, role: "agent", kind: "result", jobId: job.jobId });
      }
      if (job.status === "failed" && !next.some((m) => m.kind === "error" && m.id === `err-${job.jobId}`)) {
        next.push({
          id: `err-${job.jobId}`,
          role: "agent",
          kind: "error",
          text: job.error ?? "The audit failed. Please try again.",
        });
      }
      return next;
    });
  }, []);

  const stopJobPolling = useCallback(() => {
    pollGenRef.current += 1;
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  const runJobPoll = useCallback(async () => {
    pollTimerRef.current = null;
    const gen = pollGenRef.current;
    if (confirmInFlightRef.current) return;

    const job = activeJobRef.current;
    if (!job || !shouldPollJobStatus(job.status)) return;

    const controller = new AbortController();
    pollAbortRef.current = controller;

    try {
      const res = await fetch(`/api/audit/${job.jobId}`, {
        signal: controller.signal,
      });
      if (gen !== pollGenRef.current || confirmInFlightRef.current) return;
      if (!res.ok) return;

      const data = (await res.json()) as { job: AuditJob };
      if (gen !== pollGenRef.current || confirmInFlightRef.current) return;

      setActiveJob(() => {
        activeJobRef.current = data.job;
        return data.job;
      });

      applyJobTransition(data.job);

      if (isTerminal(data.job.status)) {
        stopJobPolling();
        void refreshChats();
        return;
      }

      if (data.job.status === "awaiting_confirmation") {
        stopJobPolling();
        return;
      }

      if (gen === pollGenRef.current && shouldPollJobStatus(data.job.status)) {
        pollTimerRef.current = window.setTimeout(() => void runJobPoll(), 3000);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (gen === pollGenRef.current && !confirmInFlightRef.current) {
        const current = activeJobRef.current;
        if (current && shouldPollJobStatus(current.status)) {
          pollTimerRef.current = window.setTimeout(() => void runJobPoll(), 3000);
        }
      }
    } finally {
      if (pollAbortRef.current === controller) {
        pollAbortRef.current = null;
      }
    }
  }, [applyJobTransition, refreshChats, stopJobPolling]);

  const startJobPolling = useCallback(() => {
    if (confirmInFlightRef.current) return;
    const job = activeJobRef.current;
    if (!job || !shouldPollJobStatus(job.status)) return;
    stopJobPolling();
    pollTimerRef.current = window.setTimeout(() => void runJobPoll(), 3000);
  }, [runJobPoll, stopJobPolling]);

  const loadChat = useCallback(
    async (chatId: string) => {
      if (chatId === activeChatIdRef.current && !switchingChatRef.current) return;

      const requestId = ++loadChatRequestRef.current;
      setSwitchingChat(true);
      setActiveChatId(chatId);
      window.localStorage.setItem(ACTIVE_CHAT_KEY, chatId);
      setInput("");
      setMessages([]);
      setActiveJob(null);
      activeJobRef.current = null;
      confirmInFlightRef.current = false;
      stopJobPolling();
      setConfirmPending(false);
      try {
        const res = await fetch(`/api/chats/${chatId}`);
        if (requestId !== loadChatRequestRef.current) return;
        if (!res.ok) throw new Error("Failed to load chat");
        const data = (await res.json()) as { chat: ChatRecord };
        if (requestId !== loadChatRequestRef.current) return;
        const job = data.chat.job;
        setActiveJob(job);
        activeJobRef.current = job;
        if (job) {
          rehydrateFromJob(job);
          if (shouldPollJobStatus(job.status)) {
            startJobPolling();
          }
        } else {
          setMessages(makeWelcome());
        }
      } catch (err) {
        if (requestId !== loadChatRequestRef.current) return;
        toast.error("Could not load chat", {
          description: (err as Error).message,
        });
        setMessages(makeWelcome());
      } finally {
        if (requestId === loadChatRequestRef.current) {
          setSwitchingChat(false);
        }
      }
    },
    [makeWelcome, rehydrateFromJob, startJobPolling, stopJobPolling],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setChatLoading(true);
      try {
        let list = await fetchChats();
        if (cancelled) return;
        if (list.chats.length === 0) {
          const created = await fetch("/api/chats", { method: "POST" });
          if (!created.ok) throw new Error("Failed to create chat");
          list = await fetchChats();
          if (cancelled) return;
        }
        setChats(list.chats);
        setNextCursor(list.nextCursor);
        const saved = window.localStorage.getItem(ACTIVE_CHAT_KEY);
        const selected =
          list.chats.find((c) => c.chatId === saved)?.chatId ??
          list.chats[0]?.chatId ??
          null;
        if (selected) await loadChat(selected);
      } catch (err) {
        toast.error("Could not initialize chat", {
          description: (err as Error).message,
        });
        setMessages(makeWelcome());
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchChats, loadChat, makeWelcome]);

  useEffect(() => () => stopJobPolling(), [stopJobPolling]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, activeJob?.status]);

  const submit = useCallback(async () => {
    const url = input.trim();
    if (!url || !activeChatId) return;
    if (activeJob) {
      toast.info("One audit per chat", {
        description: "Start a new chat to audit another app.",
      });
      return;
    }
    if (!isLikelyAppStoreUrl(url)) {
      toast.error("That doesn't look like an Apple App Store URL.", {
        description: "Try something like https://apps.apple.com/us/app/id324684580",
      });
      return;
    }
    setSubmitting(true);
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", kind: "text", text: url },
    ]);
    setInput("");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, chatId: activeChatId }),
      });
      const data = (await res.json()) as { job?: AuditJob; error?: string; jobId?: string };
      if (!res.ok || !data.job) {
        throw new Error(data.error ?? "Failed to create audit");
      }
      setActiveJob(data.job);
      activeJobRef.current = data.job;
      applyJobTransition(data.job);
      startJobPolling();
      await refreshChats();
    } catch (err) {
      toast.error("Could not start the audit", {
        description: (err as Error).message,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "agent",
          kind: "error",
          text: (err as Error).message,
        },
      ]);
    } finally {
      setSubmitting(false);
    }
  }, [activeChatId, activeJob, applyJobTransition, input, refreshChats, startJobPolling]);

  const confirm = useCallback(
    async (confirmed: boolean) => {
      if (!activeJob || confirmInFlightRef.current) return;

      stopJobPolling();
      confirmInFlightRef.current = true;
      setConfirmPending(true);

      if (confirmed) {
        setMessages((prev) => appendProgressMessage(prev, activeJob.jobId));
      }

      let resumePolling = false;
      try {
        const res = await fetch(`/api/audit/${activeJob.jobId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed }),
        });
        const data = (await res.json()) as {
          job: AuditJob | null;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? "Confirmation failed");
        }

        if (!confirmed) {
          setActiveJob(null);
          activeJobRef.current = null;
          setMessages([
            ...makeWelcome(),
            {
              id: `agent-${Date.now()}`,
              role: "agent",
              kind: "text",
              text: "No problem — paste another App Store URL and I'll try again.",
            },
          ]);
          await refreshChats();
          return;
        }

        if (!data.job) {
          throw new Error("Confirmation response missing job");
        }
        setActiveJob(data.job);
        activeJobRef.current = data.job;
        applyJobTransition(data.job);
        await refreshChats();
        resumePolling = true;
      } catch (err) {
        if (confirmed) {
          setMessages((prev) => removeProgressMessage(prev, activeJob.jobId));
        }
        toast.error("Confirmation failed", { description: (err as Error).message });
      } finally {
        confirmInFlightRef.current = false;
        setConfirmPending(false);
        if (resumePolling) {
          startJobPolling();
        }
      }
    },
    [activeJob, applyJobTransition, makeWelcome, refreshChats, startJobPolling, stopJobPolling],
  );

  const createNewChat = useCallback(async () => {
    if (creatingChat) return;
    setCreatingChat(true);
    try {
      const created = await fetch("/api/chats", { method: "POST" });
      if (!created.ok) throw new Error("Failed to create chat");
      const data = (await created.json()) as { chat: ChatRecord; created: boolean };
      if (!data.created) {
        toast.info("Reusing existing empty chat", {
          description: "Only one new chat without an audit is allowed at a time.",
        });
      }
      await refreshChats();
      await loadChat(data.chat.chatId);
      closeSidebarOnMobile();
    } catch (err) {
      toast.error("Could not create chat", {
        description: (err as Error).message,
      });
    } finally {
      setCreatingChat(false);
    }
  }, [closeSidebarOnMobile, creatingChat, loadChat, refreshChats]);

  const handlePostRemoval = useCallback(
    async (removedChatId: string) => {
      const page = await fetchChats();
      setChats(page.chats);
      setNextCursor(page.nextCursor);
      if (archivedLoadedOnce) {
        await refreshArchivedChats();
      }
      if (activeChatId !== removedChatId) return;
      const fallback = page.chats[0];
      if (fallback) {
        await loadChat(fallback.chatId);
        return;
      }
      const created = await fetch("/api/chats", { method: "POST" });
      if (!created.ok) return;
      const data = (await created.json()) as { chat: ChatRecord };
      await refreshChats();
      await loadChat(data.chat.chatId);
    },
    [activeChatId, archivedLoadedOnce, fetchChats, loadChat, refreshArchivedChats, refreshChats],
  );

  const archiveChat = useCallback(
    async (chatId: string) => {
      try {
        const res = await fetch(`/api/chats/${chatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive" }),
        });
        if (res.status === 409) {
          toast.error("Cannot archive while audit is running", {
            description: "Wait for the audit to finish, then try again.",
          });
          return;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to archive chat");
        }
        toast.success("Chat archived");
        await handlePostRemoval(chatId);
      } catch (err) {
        toast.error("Could not archive chat", {
          description: (err as Error).message,
        });
      }
    },
    [handlePostRemoval],
  );

  const restoreChat = useCallback(
    async (chatId: string) => {
      try {
        const res = await fetch(`/api/chats/${chatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to restore chat");
        }
        toast.success("Chat restored");
        await refreshChats();
        if (archivedLoadedOnce) {
          await refreshArchivedChats();
        }
      } catch (err) {
        toast.error("Could not restore chat", {
          description: (err as Error).message,
        });
      }
    },
    [archivedLoadedOnce, refreshArchivedChats, refreshChats],
  );

  const deleteChat = useCallback(
    async (chatId: string) => {
      try {
        const res = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
        if (res.status === 409) {
          toast.error("Cannot delete while audit is running", {
            description: "Wait for the audit to finish, then try again.",
          });
          return;
        }
        if (!res.ok && res.status !== 204) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to delete chat");
        }
        toast.success("Chat deleted");
        await handlePostRemoval(chatId);
      } catch (err) {
        toast.error("Could not delete chat", {
          description: (err as Error).message,
        });
      }
    },
    [handlePostRemoval],
  );

  const activeChatRecord = useMemo(() => {
    if (!activeChatId) return null;
    return (
      chats.find((c) => c.chatId === activeChatId) ??
      archivedChats.find((c) => c.chatId === activeChatId) ??
      null
    );
  }, [activeChatId, archivedChats, chats]);

  const chatTitle = useMemo(() => {
    return (
      activeJob?.metadata?.trackName ??
      activeChatRecord?.job?.metadata?.trackName ??
      "New chat"
    );
  }, [activeChatRecord?.job?.metadata?.trackName, activeJob?.metadata?.trackName]);

  const activeStatus = useMemo(() => {
    if (switchingChat) return "Loading…";
    if (!activeJob) return "Awaiting URL";
    if (activeJob.status === "awaiting_confirmation") return "Awaiting confirmation";
    if (activeJob.status === "running_audit") return "Running";
    if (activeJob.status === "fetching_metadata") return "Fetching metadata";
    if (activeJob.status === "completed") return "Completed";
    if (activeJob.status === "failed") return "Failed";
    if (activeJob.status === "cancelled") return "Cancelled";
    return "Queued";
  }, [activeJob, switchingChat]);

  const activeChatArchived = activeChatRecord?.archivedAt != null;

  const messagesLoading = chatLoading || switchingChat;

  const inputDisabled =
    submitting ||
    !activeChatId ||
    activeJob != null ||
    activeChatArchived ||
    messagesLoading;

  return (
    <div className="relative flex h-full min-h-0">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close chat history"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      <aside
        aria-label="Chat history"
        aria-hidden={!sidebarOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(85vw,18rem)] shrink-0 flex-col border-r bg-background pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out md:static md:w-72 md:bg-muted/20 md:pb-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:hidden",
        )}
      >
        <div className="border-b p-3">
          <Button
            className="w-full justify-start gap-2"
            onClick={() => void createNewChat()}
            disabled={creatingChat}
          >
            <MessageSquarePlus className="size-4" />
            {creatingChat ? "Creating..." : "New chat"}
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {chats.map((chat) => (
            <ChatListItem
              key={chat.chatId}
              chat={chat}
              selected={activeChatId === chat.chatId}
              sidebarOpen={sidebarOpen}
              onSelect={() => {
                void loadChat(chat.chatId);
                closeSidebarOnMobile();
              }}
              onArchive={() => void archiveChat(chat.chatId)}
              onRestore={() => void restoreChat(chat.chatId)}
              onDelete={() => void deleteChat(chat.chatId)}
            />
          ))}
          {nextCursor && (
            <Button
              variant="ghost"
              className="mt-1 w-full"
              onClick={() => void loadMoreChats()}
              disabled={loadingMoreChats}
              tabIndex={sidebarOpen ? 0 : -1}
            >
              {loadingMoreChats ? "Loading..." : "Load more"}
            </Button>
          )}
        </div>

        <div className="border-t">
          <button
            type="button"
            tabIndex={sidebarOpen ? 0 : -1}
            aria-expanded={archivedOpen}
            aria-controls="archived-chats-panel"
            onClick={toggleArchivedOpen}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <Archive className="size-3.5" />
              <span className="uppercase tracking-wide">Archived</span>
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 transition-transform duration-150",
                archivedOpen ? "rotate-0" : "-rotate-90",
              )}
            />
          </button>
          {archivedOpen && (
            <div
              id="archived-chats-panel"
              className="max-h-64 space-y-1 overflow-y-auto border-t p-2"
            >
              {!archivedLoadedOnce && archivedLoading ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Loading archived chats...
                </div>
              ) : archivedChats.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  No archived chats yet.
                </div>
              ) : (
                <>
                  {archivedChats.map((chat) => (
                    <ChatListItem
                      key={chat.chatId}
                      chat={chat}
                      selected={activeChatId === chat.chatId}
                      sidebarOpen={sidebarOpen}
                      archived
                      onSelect={() => {
                        void loadChat(chat.chatId);
                        closeSidebarOnMobile();
                      }}
                      onArchive={() => void archiveChat(chat.chatId)}
                      onRestore={() => void restoreChat(chat.chatId)}
                      onDelete={() => void deleteChat(chat.chatId)}
                    />
                  ))}
                  {archivedNextCursor && (
                    <Button
                      variant="ghost"
                      className="mt-1 w-full"
                      onClick={() => void loadMoreArchivedChats()}
                      disabled={archivedLoading}
                      tabIndex={sidebarOpen ? 0 : -1}
                    >
                      {archivedLoading ? "Loading..." : "Load more"}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 md:px-4 py-2 md:py-6">
          <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-4 md:max-w-4xl">
            {messagesLoading ? (
              <ChatLoadingSkeleton label={chatLoading ? "Loading chats…" : "Loading chat…"} />
            ) : (
              messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  activeJob={activeJob}
                  confirmPending={confirmPending}
                  onConfirm={() => confirm(true)}
                  onReject={() => confirm(false)}
                />
              ))
            )}
          </div>
        </div>

        <div className="border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 pt-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{chatTitle}</span>
            <span className="shrink-0">{activeStatus}</span>
          </div>
          <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={
                  messagesLoading
                    ? "Loading chat…"
                    : activeChatArchived
                      ? "This chat is archived. Restore it to continue, or start a new chat."
                      : inputDisabled
                        ? "This chat already has one audit. Start a new chat."
                        : "Paste an App Store URL, e.g. https://apps.apple.com/us/app/id324684580"
                }
                rows={1}
                className="min-h-12 resize-none text-xs md:text-sm"
                disabled={inputDisabled}
              />
            </div>
            {!inputDisabled && (
              <Button
                size="icon"
                onClick={() => void submit()}
                disabled={submitting || !input.trim()}
                aria-label="Send"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void createNewChat()}
              title="Start a new chat"
              aria-label="Start a new chat"
              disabled={creatingChat}
              className="md:hidden"
            >
              {creatingChat ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MessageSquarePlus className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void createNewChat()}
              title="Start a new chat"
              disabled={creatingChat}
              className="hidden md:inline-flex"
            >
              <MessageSquarePlus className="size-4" />
              <span>{creatingChat ? "Creating..." : "New chat"}</span>
            </Button>
          </div>
          <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
            One app audit per chat. Apple App Store URLs only.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatLoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>{label}</span>
      </div>
      <div className="flex items-start gap-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <Skeleton className="h-16 w-3/4 max-w-md rounded-2xl" />
      </div>
      <div className="flex flex-row-reverse items-start gap-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <Skeleton className="h-10 w-1/2 max-w-xs rounded-2xl" />
      </div>
      <div className="flex items-start gap-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <Skeleton className="h-24 w-full max-w-lg rounded-2xl" />
      </div>
    </div>
  );
}

function ChatListItem({
  chat,
  selected,
  sidebarOpen,
  archived = false,
  onSelect,
  onArchive,
  onRestore,
  onDelete,
}: {
  chat: ChatRecord;
  selected: boolean;
  sidebarOpen: boolean;
  archived?: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const title = chat.job?.metadata?.trackName ?? "New chat";
  const status = chat.job?.status?.replace(/_/g, " ") ?? "Awaiting URL";
  const hasRunningAudit = chat.job != null && !isTerminal(chat.job.status);
  const isNewChat = !chat.job;
  return (
    <div
      className={cn(
        "group/chat-row relative flex min-h-11 items-stretch rounded-md border transition-colors",
        selected
          ? "border-primary/40 bg-primary/5"
          : "border-transparent hover:border-border hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        tabIndex={sidebarOpen ? 0 : -1}
        className="min-w-0 flex-1 rounded-md p-2 pr-10 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={onSelect}
      >
        <div
          className={cn(
            "truncate text-sm font-medium",
            archived && "text-muted-foreground",
          )}
        >
          {title}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {archived ? "Archived" : status}
        </div>
      </button>
      {!isNewChat && <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Chat actions"
              title="Chat actions"
              tabIndex={sidebarOpen ? 0 : -1}
              className={cn(
                "absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground",
                "md:opacity-0 md:focus-visible:opacity-100 md:group-hover/chat-row:opacity-100 md:aria-expanded:opacity-100",
                selected && "md:opacity-100",
              )}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent>
          {archived ? (
            <DropdownMenuItem onClick={onRestore}>
              <ArchiveRestore className="size-4" />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onArchive} disabled={hasRunningAudit}>
              <ArchiveX className="size-4" />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onClick={onDelete}
            disabled={hasRunningAudit}
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
  );
}

function MessageRow({
  message,
  activeJob,
  confirmPending,
  onConfirm,
  onReject,
}: {
  message: ChatMessage;
  activeJob: AuditJob | null;
  confirmPending: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex items-start gap-1 md:gap-3",
        isUser && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div
        className={cn(
          "flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col gap-2",
          isUser && "items-end",
        )}
      >
        {message.kind === "text" && (
          <div
            className={cn(
              "max-w-full whitespace-pre-wrap wrap-break-word rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-2xl",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}
          >
            {message.text}
          </div>
        )}
        {message.kind === "error" && (
          <div className="max-w-full whitespace-pre-wrap wrap-break-word rounded-2xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive sm:max-w-2xl">
            {message.text}
          </div>
        )}
        {message.kind === "confirm" && activeJob?.metadata && (
          <MetadataConfirmCard
            metadata={activeJob.metadata}
            pending={confirmPending || activeJob.status !== "awaiting_confirmation"}
            onConfirm={onConfirm}
            onReject={onReject}
          />
        )}
        {message.kind === "confirm" && !activeJob?.metadata && (
          <Card className="w-full max-w-2xl">
            <CardContent className="flex items-center gap-3 py-4">
              <Skeleton className="size-16 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </CardContent>
          </Card>
        )}
        {message.kind === "progress" && activeJob && (
          <AuditProgress
            status={confirmPending ? "running_audit" : activeJob.status}
          />
        )}
        {message.kind === "result" && activeJob?.report && (
          <AuditResults
            report={activeJob.report}
            warnings={activeJob.warnings ?? []}
            metadata={activeJob.metadata ?? null}
            media={activeJob.media ?? null}
          />
        )}
      </div>
    </div>
  );
}
