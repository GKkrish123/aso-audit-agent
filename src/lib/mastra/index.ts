import "server-only";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/observability/logger";
import { asoAuditorAgent } from "./agents/aso-auditor.agent";
import { asoAuditWorkflow } from "./workflows/aso-audit.workflow";

let cached: Mastra | undefined;

function classifyStorageUrl(url: string): "file" | "memory" | "libsql-remote" | "other" {
  if (url.startsWith("file:")) return "file";
  if (url === ":memory:" || url.startsWith("memory:")) return "memory";
  if (url.startsWith("libsql:") || url.startsWith("https:") || url.startsWith("wss:")) {
    return "libsql-remote";
  }
  return "other";
}

export function getMastra(): Mastra {
  if (cached) return cached;
  const env = getEnv();
  const logger = getLogger();

  const storageKind = classifyStorageUrl(env.MASTRA_DB_URL);
  const isServerless = !!env.VERCEL;

  if (isServerless && (storageKind === "file" || storageKind === "memory")) {

    logger.error(
      {
        storage: env.MASTRA_DB_URL,
        storageKind,
        platform: env.VERCEL_ENV ?? "vercel",
        fix: "Set MASTRA_DB_URL to a Turso/libsql remote URL (e.g. libsql://<db>.turso.io) and provide MASTRA_DB_AUTH_TOKEN. See README \u00a7 Deployment.",
      },
      "MASTRA_DB_URL is a local-file/memory store on a serverless platform; workflow snapshots WILL NOT persist across invocations",
    );
  }

  const storage = new LibSQLStore({
    id: "aso-audit-store",
    url: env.MASTRA_DB_URL,
    ...(env.MASTRA_DB_AUTH_TOKEN ? { authToken: env.MASTRA_DB_AUTH_TOKEN } : {}),
  });

  cached = new Mastra({
    agents: { asoAuditor: asoAuditorAgent },
    workflows: { asoAuditWorkflow },
    storage,
  });
  logger.info(
    {
      storage: env.MASTRA_DB_URL,
      storageKind,
      serverless: isServerless,
    },
    "Mastra initialized",
  );
  return cached;
}

export const mastra = (): Mastra => getMastra();

export function describeMastraStorage(): {
  url: string;
  kind: "file" | "memory" | "libsql-remote" | "other";
  serverless: boolean;
  ok: boolean;
} {
  const env = getEnv();
  const kind = classifyStorageUrl(env.MASTRA_DB_URL);
  const serverless = !!env.VERCEL;
  return {
    url: env.MASTRA_DB_URL,
    kind,
    serverless,
    ok: !(serverless && (kind === "file" || kind === "memory")),
  };
}
