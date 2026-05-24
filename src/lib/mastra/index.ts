import "server-only";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/observability/logger";
import { asoAuditorAgent } from "./agents/aso-auditor.agent";
import { asoAuditWorkflow } from "./workflows/aso-audit.workflow";

let cached: Mastra | undefined;

export function getMastra(): Mastra {
  if (cached) return cached;
  const env = getEnv();
  const logger = getLogger();

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
  logger.info({ storage: env.MASTRA_DB_URL }, "Mastra initialized");
  return cached;
}

export const mastra = (): Mastra => getMastra();
