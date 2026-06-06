import type { Mastra } from "@mastra/core/mastra";
import { z } from "zod";
import {
  AuditReportSchema,
  RecommendationSchema,
  DimensionScoreSchema,
  type AppMetadata,
  type AuditReport,
  type Competitor,
  type CompetitorComparisonRow,
  type DimensionScore,
  type ListingContent,
} from "@/types/audit";
import { RECOMMENDATION_FORMAT_INSTRUCTIONS } from "@/lib/aso/prompts";
import {
  buildDeterministicFixCandidates,
  enrichRecommendation,
  sortByImpact,
} from "@/lib/aso/recommendations";
import { assertModelConfigured } from "@/lib/providers/llm-client";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/observability/logger";

class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `LLM call timed out after ${timeoutMs}ms. The provider did not respond ` +
        "in time; set LLM_TIMEOUT_MS higher, switch PRIMARY_MODEL to a faster " +
        "model, or add FALLBACK_MODELS for automatic failover.",
    );
    this.name = "LlmTimeoutError";
  }
}

function translateAgentError(err: unknown): Error {
  const e = err as {
    message?: string;
    text?: string;
    details?: { originalError?: string };
    cause?: { message?: string } | string;
  };
  const top = e?.message ?? e?.text ?? String(err);
  const underlying =
    e?.details?.originalError ??
    (typeof e?.cause === "string" ? e.cause : e?.cause?.message) ??
    "";

  if (/resolve model configuration|model.*not found|provider not found|unknown model/i.test(top + " " + underlying)) {
    const primary = process.env.PRIMARY_MODEL ?? "(unset)";
    return new Error(
      `LLM model "${primary}" could not be initialized.\n\n` +
        (underlying ? `Underlying error: ${underlying}\n\n` : "") +
        "Common causes:\n" +
        `  • The model id "${primary}" isn't recognized by Mastra's provider registry. ` +
        "Try a known id like 'openai/gpt-5.1', 'openai/gpt-5.1-mini', 'anthropic/claude-sonnet-4-6', 'google/gemini-2.5-flash', or route through 'openrouter/<vendor>/<model>'.\n" +
        "  • The matching provider API key isn't set in your .env.local " +
        "(OPENAI_API_KEY for openai/*, ANTHROPIC_API_KEY for anthropic/*, GOOGLE_GENERATIVE_AI_API_KEY for google/*, OPENROUTER_API_KEY for openrouter/*).\n" +
        "  • You edited .env.local without restarting `npm run dev` (Next.js only reads env on boot).",
    );
  }
  return underlying
    ? new Error(`${top} — ${underlying}`)
    : err instanceof Error
      ? err
      : new Error(top);
}

const AgentOutputSchema = z.object({
  refinedDimensionScores: z.array(DimensionScoreSchema).optional(),

  recommendations: z.array(RecommendationSchema).min(3).max(20),
  warnings: z.array(z.string()).default([]),
});

const REQUIRED_PER_BUCKET = 3;

export interface RecommendationWriterInput {
  mastra: Mastra;
  agentId: string;
  metadata: AppMetadata;
  listing: ListingContent;
  competitors: Competitor[];

  competitorComparison: CompetitorComparisonRow[];
  baselineScores: DimensionScore[];
  baselineOverallScore: number;
}

function buildPrompt(input: RecommendationWriterInput): string {
  const fixCandidates = buildDeterministicFixCandidates(input.baselineScores);
  return [
    "You are running the final stage of an ASO audit. You will be given:",
    "  - the verified app metadata,",
    "  - the listing content (title, subtitle, description, screenshots, etc),",
    "  - the top competitor apps in the same category (with deterministic",
    "    deltas vs the audited app — DO NOT recompute these numbers),",
    "  - the deterministic baseline scores per dimension and the overall score,",
    "  - a ranked list of DETERMINISTIC FIX CANDIDATES — the highest-leverage",
    "    gaps the scoring engine measured, sorted by weighted-score loss.",
    "",
    "Refine the baseline scores ONLY where you have concrete qualitative evidence",
    "(e.g. screenshot copy quality, icon distinctiveness, hook strength). Do not",
    "change scores arbitrarily; if you keep a baseline, simply omit it from",
    "`refinedDimensionScores`.",
    "",
    "Produce 3-5 recommendations in each severity bucket (quickWin, highImpact,",
    "strategic). Every recommendation MUST either (a) address one of the",
    "deterministic fix candidates with concrete before/after copy or",
    "(b) add novel qualitative insight the engine couldn't see (e.g. screenshot",
    "design clarity, icon distinctiveness, narrative arc). Cite specific",
    "deltas, chart positions, keyword overlaps, or rule failures as evidence.",
    "",
    RECOMMENDATION_FORMAT_INSTRUCTIONS,
    "",
    "=== APP METADATA ===",
    JSON.stringify(input.metadata, null, 2),
    "",
    "=== LISTING CONTENT ===",
    JSON.stringify(input.listing, null, 2),
    "",
    "=== COMPETITORS (raw scanner output) ===",
    JSON.stringify(input.competitors, null, 2),
    "",
    "=== COMPETITOR COMPARISON (deterministic — use as evidence; do not rewrite) ===",
    JSON.stringify(input.competitorComparison, null, 2),
    "",
    "=== DETERMINISTIC FIX CANDIDATES (highest weighted-loss first) ===",
    fixCandidates.length === 0
      ? "(All dimensions already score 9+ — focus on strategic/optimization recs.)"
      : JSON.stringify(fixCandidates, null, 2),
    "",
    "=== BASELINE SCORES (overall: " + String(input.baselineOverallScore) + "/100) ===",
    JSON.stringify(input.baselineScores, null, 2),
  ].join("\n");
}

export const recommendationWriterSkill = {
  id: "recommendation-writer",
  description:
    "Runs the auditor agent to produce structured recommendations grounded in the deterministic scoring baseline.",
  async run(input: RecommendationWriterInput): Promise<AuditReport> {
    assertModelConfigured();

    const env = getEnv();
    const logger = getLogger();
    const agent =
      input.mastra.getAgentById(input.agentId) ??
      (input.mastra as unknown as { getAgent: (n: string) => unknown })
        .getAgent(input.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${input.agentId}`);
    }
    const prompt = buildPrompt(input);
    const promptChars = prompt.length;
    const timeoutMs = env.LLM_TIMEOUT_MS;
    const model = env.PRIMARY_MODEL;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const startedAt = performance.now();

    logger.info(
      {
        hop: "llm.generate",
        phase: "start",
        model,
        timeoutMs,
        promptChars,
      },
      `\u25b6 llm.generate (${model}, ${promptChars} chars, ${timeoutMs}ms budget)`,
    );

    let result: { object: unknown };
    try {
      result = await Promise.race([
        (agent as {
          generate: (
            p: string,
            opts: {
              structuredOutput: { schema: typeof AgentOutputSchema };
              abortSignal?: AbortSignal;
            },
          ) => Promise<{ object: unknown }>;
        }).generate(prompt, {
          structuredOutput: { schema: AgentOutputSchema },
          abortSignal: ac.signal,
        }),
        new Promise<never>((_, reject) => {
          ac.signal.addEventListener("abort", () => {
            reject(new LlmTimeoutError(timeoutMs));
          });
        }),
      ]);
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);
      logger.error(
        {
          hop: "llm.generate",
          phase: "end",
          ok: false,
          model,
          durationMs,
          promptChars,
          err: (err as Error).message,
        },
        `\u2717 llm.generate failed (${durationMs}ms)`,
      );
      if (err instanceof LlmTimeoutError) throw err;
      throw translateAgentError(err);
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Math.round(performance.now() - startedAt);
    logger.info(
      {
        hop: "llm.generate",
        phase: "end",
        ok: true,
        model,
        durationMs,
        promptChars,
      },
      `\u2713 llm.generate (${durationMs}ms)`,
    );

    const parsed = AgentOutputSchema.parse(result.object);

    const refinedById = new Map(
      (parsed.refinedDimensionScores ?? []).map((d) => [d.id, d] as const),
    );
    const dimensionScores = input.baselineScores.map((baseline) => {
      const refined = refinedById.get(baseline.id);
      if (!refined) return baseline;
      const score = Math.max(0, Math.min(10, refined.score ?? baseline.score));
      const weight = baseline.weight;
      return {
        ...baseline,
        score,
        weight,
        weightedScore: Math.round(((score * weight) / 10) * 100) / 100,
        summary: refined.summary?.trim() ? refined.summary : baseline.summary,
        evidence: [...(baseline.evidence ?? []), ...(refined.evidence ?? [])],

        improvementHint:
          refined.improvementHint && refined.improvementHint.trim().length > 0
            ? refined.improvementHint
            : baseline.improvementHint,
      };
    });

    const overallScore = Math.round(
      dimensionScores.reduce((acc, s) => acc + s.weightedScore, 0),
    );

    const enrichedRecs = parsed.recommendations.map((r) =>
      enrichRecommendation(r, dimensionScores),
    );

    const buckets = {
      quickWin: sortByImpact(enrichedRecs.filter((r) => r.severity === "quickWin")),
      highImpact: sortByImpact(enrichedRecs.filter((r) => r.severity === "highImpact")),
      strategic: sortByImpact(enrichedRecs.filter((r) => r.severity === "strategic")),
    };
    const bucketWarnings: string[] = [];
    for (const [label, items] of Object.entries(buckets) as [
      keyof typeof buckets,
      typeof buckets.quickWin,
    ][]) {
      if (items.length < REQUIRED_PER_BUCKET) {
        bucketWarnings.push(
          `Auditor returned only ${items.length} ${label} recommendation(s); framework expects ${REQUIRED_PER_BUCKET}-5.`,
        );
      }
    }

    const orderedRecs = [
      ...buckets.quickWin,
      ...buckets.highImpact,
      ...buckets.strategic,
    ];

    const report: AuditReport = {
      overallScore: Math.max(0, Math.min(100, overallScore)),
      dimensionScores,
      recommendations: orderedRecs,

      competitorComparison: input.competitorComparison,
      warnings: [...bucketWarnings, ...parsed.warnings],
    };
    return AuditReportSchema.parse(report);
  },
};
