import { z } from "zod";

const intish = (def: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? Number.parseInt(v, 10) : v))
    .pipe(z.number().int().positive())
    .default(def);

const optionalString = z
  .string()
  .trim()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined));

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  PRIMARY_MODEL: z.string().trim().min(1).default("openai/gpt-5.5"),
  FALLBACK_MODELS: z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  OPENAI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,

  CUSTOM_MODEL_URL: optionalString,
  CUSTOM_MODEL_API_KEY: optionalString,

  MASTRA_DB_URL: z.string().trim().min(1).default("file:./mastra.db"),
  MASTRA_DB_AUTH_TOKEN: optionalString,

  FIRECRAWL_API_KEY: optionalString,

  RATE_LIMIT_RPM: intish(30),
  RATE_LIMIT_BURST: intish(10),

  METADATA_TIMEOUT_MS: intish(10_000),
  LISTING_TIMEOUT_MS: intish(15_000),
  AUDIT_MAX_DURATION_MS: intish(120_000),
  /**
   * Hard cap on a single LLM `agent.generate()` call. Any provider that hasn't
   * responded within this window is aborted so the surrounding function (Vercel
   * lambda, Node worker, etc.) doesn't get killed mid-call by the platform.
   * Default 90s leaves headroom inside a 120s Vercel Hobby budget and ~3.5x
   * headroom inside a 300s Pro budget.
   */
  LLM_TIMEOUT_MS: intish(90_000),

  /** Set automatically by Vercel; we use it to gate cloud-specific guardrails. */
  VERCEL: optionalString,
  VERCEL_ENV: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n  - ");
    throw new Error(`Invalid environment configuration:\n  - ${summary}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Test helper: reset cache. Not exported from the package barrel; intended for
 * unit tests that need to mutate process.env between cases.
 */
export function _resetEnvCache(): void {
  cached = undefined;
}
