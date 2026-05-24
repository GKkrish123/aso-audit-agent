import type { Mastra } from "@mastra/core/mastra";
import { z } from "zod";
import {
  AuditReportSchema,
  CompetitorComparisonRowSchema,
  RecommendationSchema,
  DimensionScoreSchema,
  type AppMetadata,
  type AuditReport,
  type Competitor,
  type DimensionScore,
  type ListingContent,
} from "@/types/audit";
import { RECOMMENDATION_FORMAT_INSTRUCTIONS } from "@/lib/aso/prompts";
import { assertModelConfigured } from "@/lib/providers/llm-client";

/**
 * Mastra wraps the real underlying error in a `MastraError` whose `text` is
 * the user-facing message (e.g. "Failed to resolve model configuration") and
 * stashes the real cause in `details.originalError` and/or `cause`. We dig it
 * out and rewrite the message into something a caller can actually act on -
 * surfacing the missing env var / unknown model id directly.
 */
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
  // Framework requires 3-5 recs per severity bucket (9-15 total). We allow
  // slightly more slack at the schema layer (>=3 total) and enforce the
  // per-bucket minimum at the application layer so we can surface a useful
  // warning instead of hard-failing the whole report.
  recommendations: z.array(RecommendationSchema).min(3).max(20),
  competitorComparison: z.array(CompetitorComparisonRowSchema),
  warnings: z.array(z.string()).default([]),
});

const REQUIRED_PER_BUCKET = 3;

export interface RecommendationWriterInput {
  mastra: Mastra;
  agentId: string;
  metadata: AppMetadata;
  listing: ListingContent;
  competitors: Competitor[];
  baselineScores: DimensionScore[];
  baselineOverallScore: number;
}

function buildPrompt(input: RecommendationWriterInput): string {
  return [
    "You are running the final stage of an ASO audit. You will be given:",
    "  - the verified app metadata,",
    "  - the listing content (title, subtitle, description, screenshots, etc),",
    "  - the top 3 competitor apps in the same category,",
    "  - the deterministic baseline scores per dimension and the overall score.",
    "",
    "Refine the baseline scores ONLY where you have concrete qualitative evidence",
    "(e.g. screenshot copy quality, icon distinctiveness, hook strength). Do not",
    "change scores arbitrarily; if you keep a baseline, simply omit it from",
    "`refinedDimensionScores`.",
    "",
    "Produce 3-5 recommendations in each severity bucket (quickWin, highImpact,",
    "strategic) and a competitor comparison row for each provided competitor.",
    "",
    RECOMMENDATION_FORMAT_INSTRUCTIONS,
    "",
    "=== APP METADATA ===",
    JSON.stringify(input.metadata, null, 2),
    "",
    "=== LISTING CONTENT ===",
    JSON.stringify(input.listing, null, 2),
    "",
    "=== COMPETITORS ===",
    JSON.stringify(input.competitors, null, 2),
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

    const agent =
      input.mastra.getAgentById(input.agentId) ??
      (input.mastra as unknown as { getAgent: (n: string) => unknown })
        .getAgent(input.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${input.agentId}`);
    }
    let result: { object: unknown };
    try {
      result = await (
        agent as {
          generate: (
            prompt: string,
            opts: { structuredOutput: { schema: typeof AgentOutputSchema } },
          ) => Promise<{ object: unknown }>;
        }
      ).generate(buildPrompt(input), {
        structuredOutput: { schema: AgentOutputSchema },
      });
    } catch (err) {
      throw translateAgentError(err);
    }

    const parsed = AgentOutputSchema.parse(result.object);

    const refinedById = new Map(
      (parsed.refinedDimensionScores ?? []).map((d) => [d.id, d] as const),
    );
    const dimensionScores = input.baselineScores.map((b) => refinedById.get(b.id) ?? b);

    const overallScore = Math.round(
      dimensionScores.reduce((acc, s) => acc + s.weightedScore, 0),
    );

    const buckets = {
      quickWin: parsed.recommendations.filter((r) => r.severity === "quickWin"),
      highImpact: parsed.recommendations.filter((r) => r.severity === "highImpact"),
      strategic: parsed.recommendations.filter((r) => r.severity === "strategic"),
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

    const report: AuditReport = {
      overallScore: Math.max(0, Math.min(100, overallScore)),
      dimensionScores,
      recommendations: parsed.recommendations,
      competitorComparison: parsed.competitorComparison,
      warnings: [...bucketWarnings, ...parsed.warnings],
    };
    return AuditReportSchema.parse(report);
  },
};
