import {
  type AppMetadata,
  type Competitor,
  type DimensionScore,
  type ListingContent,
} from "@/types/audit";
import {
  aggregateOverallScore,
  computeBaselineScores,
} from "@/lib/aso/scoring";

export interface ScoringNormalizationInput {
  metadata: AppMetadata;
  listing: ListingContent;
  competitors: Competitor[];
}

export interface ScoringNormalizationOutput {
  dimensionScores: DimensionScore[];
  overallScore: number;
}

export const scoringNormalizationSkill = {
  id: "scoring-normalization",
  description:
    "Computes deterministic per-dimension and overall ASO scores from the listing, metadata, and competitor data.",
  run(input: ScoringNormalizationInput): ScoringNormalizationOutput {
    const dimensionScores = computeBaselineScores(input);
    const overallScore = aggregateOverallScore(dimensionScores);
    return { dimensionScores, overallScore };
  },
};
