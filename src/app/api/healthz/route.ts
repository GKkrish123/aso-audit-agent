import { NextResponse } from "next/server";
import { getMetrics } from "@/lib/observability/metrics";
import { describeMastraStorage } from "@/lib/mastra";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskTail(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "***";
  return `***${value.slice(-4)}`;
}

export async function GET(): Promise<Response> {
  const env = getEnv();
  const storage = describeMastraStorage();
  const snapshot = getMetrics().snapshot();
  const warnings: string[] = [];
  if (!storage.ok) {
    warnings.push(
      `MASTRA_DB_URL is a ${storage.kind} store on a serverless platform; workflow snapshots will not persist across invocations. Switch to a libsql remote URL (e.g. libsql://<db>.turso.io) and set MASTRA_DB_AUTH_TOKEN.`,
    );
  }

  return NextResponse.json({
    ok: storage.ok,
    uptimeSeconds: Math.round(process.uptime()),
    nodeEnv: env.NODE_ENV,
    vercelEnv: env.VERCEL_ENV ?? null,
    storage,
    llm: {
      primaryModel: env.PRIMARY_MODEL,
      fallbackModels: env.FALLBACK_MODELS,
      timeoutMs: env.LLM_TIMEOUT_MS,
      hasOpenAIKey: !!env.OPENAI_API_KEY,
      hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
      hasGoogleKey: !!env.GOOGLE_GENERATIVE_AI_API_KEY,
      hasOpenRouterKey: !!env.OPENROUTER_API_KEY,
      hasCustomEndpoint: !!env.CUSTOM_MODEL_URL,
      customEndpointApiKey: maskTail(env.CUSTOM_MODEL_API_KEY),
    },
    firecrawl: {
      enabled: !!env.FIRECRAWL_API_KEY,
    },
    budgets: {
      metadataTimeoutMs: env.METADATA_TIMEOUT_MS,
      listingTimeoutMs: env.LISTING_TIMEOUT_MS,
      auditMaxDurationMs: env.AUDIT_MAX_DURATION_MS,
    },
    warnings,
    metrics: snapshot,
  });
}
