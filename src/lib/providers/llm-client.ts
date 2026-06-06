import type { Agent } from "@mastra/core/agent";
import { getEnv, type Env } from "../env";

type ConstructorParam<T> = T extends new (config: infer C) => unknown ? C : never;
type AgentConfig = ConstructorParam<typeof Agent>;
export type AgentModelConfig = AgentConfig["model"];

type ModelConfig = string | { id: string; url?: string; apiKey?: string };

interface ModelFallbackEntry {
  id: string;
  model: ModelConfig;
  maxRetries?: number;
  enabled?: boolean;
}

const PROVIDER_KEY_ENV: Record<string, keyof Env> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

function providerOf(model: string): string {
  return model.split("/")[0]?.toLowerCase() ?? "";
}

export function assertModelConfigured(env: Env = getEnv()): void {
  if (env.CUSTOM_MODEL_URL) {
    if (!env.CUSTOM_MODEL_API_KEY) {
      throw new ModelConfigError(
        "CUSTOM_MODEL_URL is set but CUSTOM_MODEL_API_KEY is empty. Set CUSTOM_MODEL_API_KEY in your environment.",
      );
    }
    return;
  }

  const models = [env.PRIMARY_MODEL, ...env.FALLBACK_MODELS].filter(Boolean);
  for (const model of models) {
    const provider = providerOf(model);
    const envKey = PROVIDER_KEY_ENV[provider];
    if (envKey && !env[envKey]) {
      throw new ModelConfigError(
        `Model "${model}" requires ${envKey} but it is not set. ` +
          `Set ${envKey} in your .env.local (or switch PRIMARY_MODEL to a provider you have credentials for).`,
      );
    }
  }
}

function preserveCustomModelId(rawId: string): string {
  if (rawId.startsWith("custom/")) return rawId;
  return `custom/${rawId}`;
}

function buildPrimary(env: Env): ModelConfig {
  if (env.CUSTOM_MODEL_URL) {
    return {
      id: preserveCustomModelId(env.PRIMARY_MODEL),
      url: env.CUSTOM_MODEL_URL,
      ...(env.CUSTOM_MODEL_API_KEY ? { apiKey: env.CUSTOM_MODEL_API_KEY } : {}),
    };
  }
  return env.PRIMARY_MODEL;
}

function buildFallbackEntries(env: Env): ModelFallbackEntry[] {
  return env.FALLBACK_MODELS.map((m, i) => ({
    id: `fallback-${i + 1}`,
    model: m,
    maxRetries: 2,
    enabled: true,
  }));
}

export function getAgentModel(): AgentModelConfig {
  const env = getEnv();
  const primary = buildPrimary(env);
  const fallbacks = buildFallbackEntries(env);
  if (fallbacks.length === 0) {
    return primary as AgentModelConfig;
  }
  const primaryEntry: ModelFallbackEntry = {
    id: "primary",
    model: primary,
    maxRetries: 3,
    enabled: true,
  };
  return [primaryEntry, ...fallbacks] as AgentModelConfig;
}
