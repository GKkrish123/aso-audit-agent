import "server-only";
import { after } from "next/server";
import { nanoid } from "nanoid";
import { createClient, type Client } from "@libsql/client";
import { getLogger } from "@/lib/observability/logger";
import { getMastra } from "@/lib/mastra";
import { getEnv } from "@/lib/env";
import { resolveAuditJobStatus } from "@/lib/jobs/audit-job-status";
import {
  AppMetadataSchema,
  AuditReportSchema,
  type AppMetadata,
  type AuditJob,
  type AuditJobStatus,
  type AuditReport,
} from "@/types/audit";

interface SnapshotShape {
  status?: string;
  result?: {
    metadata?: unknown;
    report?: unknown;
    warnings?: unknown;
  };

  steps?: Record<
    string,
    {
      status?: string;
      output?: unknown;
      suspendOutput?: unknown;
      suspendPayload?: unknown;
      payload?: unknown;
    }
  >;

  initialState?: { metadata?: unknown; parsed?: unknown; warnings?: unknown };
  error?: { message?: string } | string;
  payload?: { url?: string };
  suspendedPaths?: Record<string, number[]>;
}

interface JobIndexEntry {
  jobId: string;
  chatId: string;
  runId: string;
  inputUrl: string;
  createdAt: number;
  confirmedAt: number | null;
}

export interface ChatSession {
  chatId: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface ChatSessionDetails extends ChatSession {
  job: AuditJob | null;
}

export interface PaginatedChatSessions {
  chats: ChatSessionDetails[];
  nextCursor: string | null;
}

export interface CreateChatSessionResult {
  chat: ChatSession;
  created: boolean;
}

interface ChatCursor {
  updatedAt: number;
  chatId: string;
}

export class ChatNotFoundError extends Error {
  constructor(chatId: string) {
    super(`Unknown chatId: ${chatId}`);
    this.name = "ChatNotFoundError";
  }
}

export class OneAuditPerChatError extends Error {
  readonly existingJobId: string;

  constructor(chatId: string, existingJobId: string) {
    super(`Chat ${chatId} already has an audit job (${existingJobId})`);
    this.name = "OneAuditPerChatError";
    this.existingJobId = existingJobId;
  }
}

export class InvalidChatCursorError extends Error {
  constructor() {
    super("Invalid chat history cursor");
    this.name = "InvalidChatCursorError";
  }
}

export class ChatHasActiveAuditError extends Error {
  constructor(chatId: string) {
    super(`Chat ${chatId} has an active audit and cannot be modified`);
    this.name = "ChatHasActiveAuditError";
  }
}

function asMetadata(value: unknown): AppMetadata | null {
  const parsed = AppMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asReport(value: unknown): AuditReport | null {
  const parsed = AuditReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asMedia(
  listing: unknown,
  metadata: AppMetadata | null,
): AuditJob["media"] {
  const l = (listing && typeof listing === "object" ? listing : null) as
    | {
        screenshotUrls?: unknown;
        ipadScreenshotUrls?: unknown;
        appPreviewVideoUrls?: unknown;
        appPreviewVideoPosters?: unknown;
      }
    | null;
  const onlyUrls = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];

  const iphoneScreenshots = onlyUrls(l?.screenshotUrls);
  const ipadScreenshots = onlyUrls(l?.ipadScreenshotUrls);
  const videoUrls = onlyUrls(l?.appPreviewVideoUrls);
  const videoPostersRaw = Array.isArray(l?.appPreviewVideoPosters)
    ? l.appPreviewVideoPosters
    : [];
  const appPreviewVideos = videoUrls.map((url, i) => {
    const poster = videoPostersRaw[i];
    return {
      url,
      posterUrl:
        typeof poster === "string" && poster.length > 0 ? poster : null,
    };
  });
  const iconUrl = metadata?.artworkUrl ?? null;

  if (
    iphoneScreenshots.length === 0 &&
    ipadScreenshots.length === 0 &&
    appPreviewVideos.length === 0 &&
    !iconUrl
  ) {
    return null;
  }

  return {
    iconUrl,
    iphoneScreenshots,
    ipadScreenshots,
    appPreviewVideos,
  };
}

function getStepOutput(
  snapshot: SnapshotShape,
  stepId: string,
): Record<string, unknown> | undefined {
  const step = snapshot.steps?.[stepId];
  if (!step) return undefined;
  const out = step.output ?? step.suspendOutput;
  return out && typeof out === "object" ? (out as Record<string, unknown>) : undefined;
}

function hasPassedConfirmationGate(snapshot: SnapshotShape): boolean {
  const confirmStep = snapshot.steps?.["await-confirmation"];
  if (confirmStep?.status === "success") return true;
  const auditStep = snapshot.steps?.["run-audit"];
  return auditStep?.status === "running" || auditStep?.status === "success";
}

function isAwaitingConfirmation(snapshot: SnapshotShape): boolean {
  if (hasPassedConfirmationGate(snapshot)) return false;
  const fetchStep = snapshot.steps?.["fetch-metadata"];
  if (fetchStep?.status !== "success") return false;
  const confirmStep = snapshot.steps?.["await-confirmation"];
  if (confirmStep?.status === "suspended") return true;
  if (snapshot.status === "suspended") return true;
  return confirmStep?.status !== "success";
}

function inferStatus(snapshot: SnapshotShape): AuditJobStatus {
  const raw = snapshot.status;
  if (raw === "success") return "completed";
  if (raw === "failed") return "failed";
  if (raw === "cancelled" || raw === "canceled") return "cancelled";

  const auditStep = snapshot.steps?.["run-audit"];
  if (auditStep?.status === "failed") return "failed";
  if (auditStep?.status === "success") return "completed";
  if (auditStep?.status === "running") return "running_audit";

  if (isAwaitingConfirmation(snapshot)) return "awaiting_confirmation";
  if (hasPassedConfirmationGate(snapshot)) return "running_audit";

  if (raw === "running" || raw === "waiting" || raw === "suspended") {
    const fetchStep = snapshot.steps?.["fetch-metadata"];
    if (fetchStep?.status === "success") return "awaiting_confirmation";
    return "fetching_metadata";
  }

  return "queued";
}

function snapshotToJob(
  jobId: string,
  runId: string,
  inputUrl: string,
  snapshot: SnapshotShape,
  createdAt: number,
): AuditJob {
  const fetchOut = getStepOutput(snapshot, "fetch-metadata");
  const auditOut = getStepOutput(snapshot, "run-audit");
  const metadata =
    asMetadata(auditOut?.metadata) ??
    asMetadata(fetchOut?.metadata) ??
    asMetadata(snapshot.initialState?.metadata);
  const report = asReport(auditOut?.report) ?? asReport(snapshot.result?.report);
  const media = asMedia(auditOut?.listing, metadata);
  const parsedRaw =
    (fetchOut?.parsed as { appId?: string; storefront?: string; canonicalUrl?: string } | undefined) ??
    (snapshot.initialState?.parsed as
      | { appId?: string; storefront?: string; canonicalUrl?: string }
      | undefined);
  const parsed = parsedRaw?.appId
    ? {
        appId: String(parsedRaw.appId),
        storefront: String(parsedRaw.storefront ?? "us"),
        canonicalUrl: String(parsedRaw.canonicalUrl ?? ""),
      }
    : null;
  const warnings = Array.isArray(auditOut?.warnings)
    ? (auditOut!.warnings as string[])
    : Array.isArray(snapshot.initialState?.warnings)
      ? (snapshot.initialState!.warnings as string[])
      : [];
  const errorMsg = snapshot.error
    ? typeof snapshot.error === "string"
      ? snapshot.error
      : snapshot.error.message
    : null;

  return {
    jobId,
    runId,
    status: inferStatus(snapshot),
    inputUrl,
    parsed,
    metadata,
    report,
    media,
    warnings,
    error: errorMsg ?? null,
    createdAt,
    updatedAt: Date.now(),
  };
}

let cachedDbClient: Client | undefined;
let schemaReady: Promise<void> | undefined;

function getDb(): Client {
  if (cachedDbClient) return cachedDbClient;
  const env = getEnv();
  cachedDbClient = createClient({
    url: env.MASTRA_DB_URL,
    ...(env.MASTRA_DB_AUTH_TOKEN ? { authToken: env.MASTRA_DB_AUTH_TOKEN } : {}),
  });
  return cachedDbClient;
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = getDb();
    await db.execute(
      "CREATE TABLE IF NOT EXISTS chat_sessions (chat_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER)",
    );
    await db.execute(
      "CREATE TABLE IF NOT EXISTS audit_jobs (job_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL UNIQUE, input_url TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (chat_id) REFERENCES chat_sessions(chat_id) ON DELETE CASCADE)",
    );
    try {
      await db.execute("ALTER TABLE chat_sessions ADD COLUMN archived_at INTEGER");
    } catch {

    }
    try {
      await db.execute("ALTER TABLE audit_jobs ADD COLUMN confirmed_at INTEGER");
    } catch {

    }
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC)",
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_chat_sessions_archived_updated ON chat_sessions(archived_at, updated_at DESC, chat_id DESC)",
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_audit_jobs_chat_id ON audit_jobs(chat_id)",
    );
  })();
  try {
    await schemaReady;
  } catch (err) {

    schemaReady = undefined;
    throw err;
  }
}

function rowToNumber(row: Record<string, unknown>, key: string): number {
  const val = row[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number(val);
  return 0;
}

function rowToString(row: Record<string, unknown>, key: string): string {
  const val = row[key];
  return typeof val === "string" ? val : "";
}

function rowToNullableNumber(row: Record<string, unknown>, key: string): number | null {
  const val = row[key];
  if (val == null) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number(val);
  return null;
}

function isTerminalAuditStatus(status: AuditJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function encodeCursor(cursor: ChatCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value?: string): ChatCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ChatCursor>;
    if (
      typeof parsed.updatedAt !== "number" ||
      Number.isNaN(parsed.updatedAt) ||
      typeof parsed.chatId !== "string" ||
      parsed.chatId.length === 0
    ) {
      throw new InvalidChatCursorError();
    }
    return { updatedAt: parsed.updatedAt, chatId: parsed.chatId };
  } catch {
    throw new InvalidChatCursorError();
  }
}

async function getJobEntry(jobId: string): Promise<JobIndexEntry | null> {
  await ensureSchema();
  const db = getDb();
  const rs = await db.execute({
    sql: "SELECT job_id, chat_id, run_id, input_url, created_at, confirmed_at FROM audit_jobs WHERE job_id = ? LIMIT 1",
    args: [jobId],
  });
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    jobId: rowToString(row, "job_id"),
    chatId: rowToString(row, "chat_id"),
    runId: rowToString(row, "run_id"),
    inputUrl: rowToString(row, "input_url"),
    createdAt: rowToNumber(row, "created_at"),
    confirmedAt: rowToNullableNumber(row, "confirmed_at"),
  };
}

async function getJobEntryByChatId(chatId: string): Promise<JobIndexEntry | null> {
  await ensureSchema();
  const db = getDb();
  const rs = await db.execute({
    sql: "SELECT job_id, chat_id, run_id, input_url, created_at, confirmed_at FROM audit_jobs WHERE chat_id = ? LIMIT 1",
    args: [chatId],
  });
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    jobId: rowToString(row, "job_id"),
    chatId: rowToString(row, "chat_id"),
    runId: rowToString(row, "run_id"),
    inputUrl: rowToString(row, "input_url"),
    createdAt: rowToNumber(row, "created_at"),
    confirmedAt: rowToNullableNumber(row, "confirmed_at"),
  };
}

export async function createChatSession(): Promise<CreateChatSessionResult> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT c.chat_id, c.created_at, c.updated_at, c.archived_at FROM chat_sessions c LEFT JOIN audit_jobs j ON j.chat_id = c.chat_id WHERE c.archived_at IS NULL AND j.job_id IS NULL ORDER BY c.updated_at DESC, c.chat_id DESC LIMIT 1",
  });
  const existingRow = existing.rows[0] as Record<string, unknown> | undefined;
  if (existingRow) {
    return {
      chat: {
        chatId: rowToString(existingRow, "chat_id"),
        createdAt: rowToNumber(existingRow, "created_at"),
        updatedAt: rowToNumber(existingRow, "updated_at"),
        archivedAt: rowToNullableNumber(existingRow, "archived_at"),
      },
      created: false,
    };
  }
  const now = Date.now();
  const chatId = nanoid(12);
  await db.execute({
    sql: "INSERT INTO chat_sessions (chat_id, created_at, updated_at, archived_at) VALUES (?, ?, ?, NULL)",
    args: [chatId, now, now],
  });
  return { chat: { chatId, createdAt: now, updatedAt: now, archivedAt: null }, created: true };
}

export async function listChatSessions(input?: {
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
  archivedOnly?: boolean;
}): Promise<PaginatedChatSessions> {
  await ensureSchema();
  const db = getDb();
  const limit = Math.max(1, Math.min(50, input?.limit ?? 20));
  const cursor = decodeCursor(input?.cursor);
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (input?.archivedOnly) {
    where.push("archived_at IS NOT NULL");
  } else if (!input?.includeArchived) {
    where.push("archived_at IS NULL");
  }
  if (cursor) {
    where.push("(updated_at < ? OR (updated_at = ? AND chat_id < ?))");
    args.push(cursor.updatedAt, cursor.updatedAt, cursor.chatId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rs = await db.execute({
    sql: `SELECT chat_id, created_at, updated_at, archived_at FROM chat_sessions ${whereSql} ORDER BY updated_at DESC, chat_id DESC LIMIT ?`,
    args: [...args, limit + 1],
  });
  const rows = rs.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      chatId: rowToString(r, "chat_id"),
      createdAt: rowToNumber(r, "created_at"),
      updatedAt: rowToNumber(r, "updated_at"),
      archivedAt: rowToNullableNumber(r, "archived_at"),
    };
  });
  const hasMore = rows.length > limit;
  const chats = hasMore ? rows.slice(0, limit) : rows;
  const withJobs = await Promise.all(
    chats.map(async (chat) => {
      const jobEntry = await getJobEntryByChatId(chat.chatId);
      const job = jobEntry ? await getAuditJob(jobEntry.jobId) : null;
      return { ...chat, job };
    }),
  );
  const tail = withJobs[withJobs.length - 1];
  return {
    chats: withJobs,
    nextCursor: hasMore && tail ? encodeCursor({ updatedAt: tail.updatedAt, chatId: tail.chatId }) : null,
  };
}

export async function getChatSession(chatId: string): Promise<ChatSessionDetails> {
  await ensureSchema();
  const db = getDb();
  const rs = await db.execute({
    sql: "SELECT chat_id, created_at, updated_at, archived_at FROM chat_sessions WHERE chat_id = ? LIMIT 1",
    args: [chatId],
  });
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new ChatNotFoundError(chatId);
  const jobEntry = await getJobEntryByChatId(chatId);
  const job = jobEntry ? await getAuditJob(jobEntry.jobId) : null;
  return {
    chatId: rowToString(row, "chat_id"),
    createdAt: rowToNumber(row, "created_at"),
    updatedAt: rowToNumber(row, "updated_at"),
    archivedAt: rowToNullableNumber(row, "archived_at"),
    job,
  };
}

async function ensureChatModifiable(chatId: string): Promise<void> {
  const entry = await getJobEntryByChatId(chatId);
  if (!entry) return;
  const job = await getAuditJob(entry.jobId);
  if (!isTerminalAuditStatus(job.status)) {
    throw new ChatHasActiveAuditError(chatId);
  }
}

export async function archiveChatSession(chatId: string): Promise<ChatSessionDetails> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT chat_id FROM chat_sessions WHERE chat_id = ? LIMIT 1",
    args: [chatId],
  });
  if (!existing.rows[0]) throw new ChatNotFoundError(chatId);
  await ensureChatModifiable(chatId);
  const now = Date.now();
  await db.execute({
    sql: "UPDATE chat_sessions SET archived_at = ?, updated_at = ? WHERE chat_id = ?",
    args: [now, now, chatId],
  });
  return await getChatSession(chatId);
}

export async function restoreChatSession(chatId: string): Promise<ChatSessionDetails> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT chat_id FROM chat_sessions WHERE chat_id = ? LIMIT 1",
    args: [chatId],
  });
  if (!existing.rows[0]) throw new ChatNotFoundError(chatId);
  const now = Date.now();
  await db.execute({
    sql: "UPDATE chat_sessions SET archived_at = NULL, updated_at = ? WHERE chat_id = ?",
    args: [now, chatId],
  });
  return await getChatSession(chatId);
}

export async function deleteChatSession(chatId: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT chat_id FROM chat_sessions WHERE chat_id = ? LIMIT 1",
    args: [chatId],
  });
  if (!existing.rows[0]) throw new ChatNotFoundError(chatId);
  await ensureChatModifiable(chatId);
  await db.execute({
    sql: "DELETE FROM chat_sessions WHERE chat_id = ?",
    args: [chatId],
  });
}

export async function createAuditJob(input: { url: string; chatId: string }): Promise<AuditJob> {
  const logger = getLogger();
  const mastra = getMastra();
  const workflow = mastra.getWorkflow("asoAuditWorkflow");

  await ensureSchema();
  const db = getDb();
  const existingChat = await db.execute({
    sql: "SELECT chat_id FROM chat_sessions WHERE chat_id = ? AND archived_at IS NULL LIMIT 1",
    args: [input.chatId],
  });
  if (!existingChat.rows[0]) throw new ChatNotFoundError(input.chatId);
  const existingJob = await getJobEntryByChatId(input.chatId);
  if (existingJob) throw new OneAuditPerChatError(input.chatId, existingJob.jobId);

  const jobId = nanoid(12);
  const run = await workflow.createRun();
  const createdAt = Date.now();
  await db.batch([
    {
      sql: "INSERT INTO audit_jobs (job_id, chat_id, run_id, input_url, created_at, updated_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      args: [jobId, input.chatId, run.runId, input.url, createdAt, createdAt],
    },
    {
      sql: "UPDATE chat_sessions SET updated_at = ? WHERE chat_id = ?",
      args: [createdAt, input.chatId],
    },
  ]);

  logger.info({ jobId, chatId: input.chatId, runId: run.runId }, "audit job created");

  const startStartedAt = performance.now();
  run
    .start({ inputData: { url: input.url } })
    .then(() => {
      logger.info(
        {
          jobId,
          runId: run.runId,
          hop: "workflow.start",
          phase: "settled",
          durationMs: Math.round(performance.now() - startStartedAt),
        },
        "workflow.start settled (suspended at confirmation gate)",
      );
    })
    .catch((err) => {
      logger.error(
        {
          jobId,
          runId: run.runId,
          hop: "workflow.start",
          phase: "settled",
          ok: false,
          durationMs: Math.round(performance.now() - startStartedAt),
          err: (err as Error).message,
        },
        "workflow start failed",
      );
    });

  return await waitForConfirmationGate(jobId);
}

async function waitForConfirmationGate(jobId: string): Promise<AuditJob> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const job = await getAuditJob(jobId);
    if (job.status === "awaiting_confirmation") return job;
    if (job.status === "failed" || job.status === "cancelled") return job;
    if (job.status === "completed") {
      getLogger().error(
        { jobId, status: job.status },
        "workflow completed before user confirmed",
      );
      return job;
    }

    await new Promise((r) => setTimeout(r, 200));
  }
  const job = await getAuditJob(jobId);
  if (job.status === "running_audit") {
    getLogger().error(
      { jobId, status: job.status },
      "confirmation gate timed out while status was running_audit",
    );
  }
  return job;
}

export async function getAuditJob(jobId: string): Promise<AuditJob> {
  const idx = await getJobEntry(jobId);
  if (!idx) throw new Error(`Unknown jobId: ${jobId}`);
  const mastra = getMastra();
  const workflow = mastra.getWorkflow("asoAuditWorkflow");
  const snapshot = (await workflow.getWorkflowRunById(idx.runId)) as
    | SnapshotShape
    | null
    | undefined;
  if (!snapshot) {
    return {
      jobId,
      runId: idx.runId,
      status: resolveAuditJobStatus("queued", idx.confirmedAt),
      inputUrl: idx.inputUrl,
      parsed: null,
      metadata: null,
      report: null,
      media: null,
      warnings: [],
      error: null,
      createdAt: idx.createdAt,
      updatedAt: Date.now(),
    };
  }
  const job = snapshotToJob(idx.jobId, idx.runId, idx.inputUrl, snapshot, idx.createdAt);
  return {
    ...job,
    status: resolveAuditJobStatus(job.status, idx.confirmedAt),
  };
}

async function waitForResumeToProgress(
  jobId: string,
  maxMs = 5_000,
): Promise<AuditJob> {
  const started = Date.now();
  let job = await getAuditJob(jobId);
  while (
    job.status === "awaiting_confirmation" &&
    Date.now() - started < maxMs
  ) {
    await new Promise((r) => setTimeout(r, 120));
    job = await getAuditJob(jobId);
  }
  return job;
}

export async function confirmAuditJob(
  jobId: string,
  confirmed: boolean,
): Promise<AuditJob | null> {
  const logger = getLogger();
  const idx = await getJobEntry(jobId);
  if (!idx) throw new Error(`Unknown jobId: ${jobId}`);
  await ensureSchema();

  const scheduleWorkflowResume = () => {
    const mastra = getMastra();
    const workflow = mastra.getWorkflow("asoAuditWorkflow");
    const resumeStartedAt = performance.now();
    logger.info(
      {
        jobId,
        runId: idx.runId,
        hop: "workflow.resume",
        phase: "start",
        confirmed,
      },
      `\u25b6 workflow.resume (confirmed=${confirmed})`,
    );
    const resumeWork = workflow
      .createRun({ runId: idx.runId })
      .then((run) =>
        run.resume({ step: "await-confirmation", resumeData: { confirmed } }),
      )
      .then((res) => {
        logger.info(
          {
            jobId,
            runId: idx.runId,
            hop: "workflow.resume",
            phase: "end",
            ok: true,
            confirmed,
            durationMs: Math.round(performance.now() - resumeStartedAt),
            workflowStatus: (res as { status?: string } | undefined)?.status ?? null,
          },
          "\u2713 workflow.resume settled",
        );
        return res;
      })
      .catch((err) => {
        const level = confirmed ? "error" : "info";
        logger[level](
          {
            jobId,
            runId: idx.runId,
            hop: "workflow.resume",
            phase: "end",
            ok: false,
            confirmed,
            durationMs: Math.round(performance.now() - resumeStartedAt),
            err: (err as Error).message,
          },
          confirmed
            ? "\u2717 workflow.resume failed"
            : "workflow.resume completed with rejection",
        );
      });

    after(async () => {
      await resumeWork;
    });
  };

  if (!confirmed) {
    await getDb().batch([
      {
        sql: "DELETE FROM audit_jobs WHERE job_id = ?",
        args: [jobId],
      },
      {
        sql: "UPDATE chat_sessions SET updated_at = ? WHERE chat_id = ?",
        args: [Date.now(), idx.chatId],
      },
    ]);
    logger.info(
      { jobId, chatId: idx.chatId },
      "audit rejected before start; chat released",
    );
    scheduleWorkflowResume();
    return null;
  }

  const confirmedAt = Date.now();
  await getDb().batch([
    {
      sql: "UPDATE audit_jobs SET confirmed_at = ?, updated_at = ? WHERE job_id = ?",
      args: [confirmedAt, confirmedAt, jobId],
    },
    {
      sql: "UPDATE chat_sessions SET updated_at = ? WHERE chat_id = ?",
      args: [confirmedAt, idx.chatId],
    },
  ]);

  scheduleWorkflowResume();

  const job = await waitForResumeToProgress(jobId);
  return {
    ...job,
    status: resolveAuditJobStatus(job.status, confirmedAt),
  };
}
