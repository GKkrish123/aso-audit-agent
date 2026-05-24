import { Bot, Sparkles } from "lucide-react";
import { AuditChat } from "@/components/chat/audit-chat";
import { SidebarToggle } from "@/components/chat/sidebar-toggle";

export default function Home() {
  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarToggle />
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Bot className="size-4" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-heading text-sm font-semibold leading-tight">
                ASO Audit Agent
              </span>
              <span className="hidden truncate text-xs leading-tight text-muted-foreground sm:block">
                Apple App Store, audited by a Mastra agent
              </span>
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground md:flex">
            <Sparkles className="size-3.5" />
            <span>Pluggable LLM · Deterministic Scoring · Evidence Backed Recs</span>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <AuditChat />
      </main>
    </div>
  );
}
