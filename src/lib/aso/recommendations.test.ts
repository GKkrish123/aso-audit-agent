import { describe, expect, it } from "vitest";
import {
  defaultEffortForSeverity,
  enrichRecommendation,
  normalizeLlmRecommendation,
} from "@/lib/aso/recommendations";
import type { DimensionScore, LlmRecommendation } from "@/types/audit";

const baseRec: LlmRecommendation = {
  id: "title-fix",
  dimension: "title",
  severity: "quickWin",
  title: "Improve the title",
  rationale: "The title is too short for the category.",
  evidence: "Title is 12/30 chars.",
  before: "My App",
  after: "My App: Better Title",
};

const baselineScores: DimensionScore[] = [
  {
    id: "title",
    weight: 20,
    score: 6,
    weightedScore: 12,
    summary: "Title is short.",
    evidence: [],
    components: [],
    observedValue: "12/30 chars",
    target: "26-30 chars",
    source: "merged",
    confidence: "deterministic",
    improvementHint: null,
  },
];

describe("normalizeLlmRecommendation", () => {
  it("drops zero or invalid effort estimates", () => {
    expect(
      normalizeLlmRecommendation({
        ...baseRec,
        effort: { unit: "minutes", estimate: 0 },
      }).effort,
    ).toBeUndefined();
  });

  it("keeps positive effort estimates", () => {
    expect(
      normalizeLlmRecommendation({
        ...baseRec,
        effort: { unit: "minutes", estimate: 15 },
      }).effort,
    ).toEqual({ unit: "minutes", estimate: 15 });
  });
});

describe("enrichRecommendation", () => {
  it("fills default effort when LLM effort was invalid", () => {
    const enriched = enrichRecommendation(
      normalizeLlmRecommendation({
        ...baseRec,
        effort: { unit: "hours", estimate: 0 },
      }),
      baselineScores,
    );

    expect(enriched.effort).toEqual(defaultEffortForSeverity("quickWin"));
  });
});
