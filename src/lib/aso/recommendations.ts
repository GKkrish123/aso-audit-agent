import {
  DIMENSION_WEIGHTS,
  type DimensionId,
  type DimensionScore,
  type Recommendation,
  type RecommendationCategory,
} from "@/types/audit";

export const DIMENSION_DEFAULT_CATEGORY: Record<DimensionId, RecommendationCategory> = {
  title: "copy",
  subtitle: "copy",
  keywordField: "copy",
  description: "copy",
  screenshots: "design",
  appPreviewVideo: "media",
  ratingsAndReviews: "engineering",
  icon: "design",
  conversionSignals: "copy",
  competitivePosition: "strategy",
};

export const DIMENSION_DEFAULT_LOCATION: Record<DimensionId, string> = {
  title: "App Store Connect → App Information → Name (per locale)",
  subtitle: "App Store Connect → App Information → Subtitle (per locale)",
  keywordField: "App Store Connect → Version → Keywords",
  description: "App Store Connect → Version → Description",
  screenshots: "App Store Connect → Version → App Previews and Screenshots",
  appPreviewVideo: "App Store Connect → Version → App Previews and Screenshots → App Preview",
  ratingsAndReviews: "In-app review prompts (SKStoreReviewController) + App Store Connect → Ratings & Reviews",
  icon: "App Store Connect → Version → App Icon (1024×1024)",
  conversionSignals: "App Store Connect → Version → Promotional Text / What's New / In-App Events",
  competitivePosition: "Off-listing: paid acquisition, partnerships, category positioning",
};

export function defaultEffortForSeverity(
  severity: Recommendation["severity"],
): NonNullable<Recommendation["effort"]> {
  switch (severity) {
    case "quickWin":
      return { unit: "minutes", estimate: 30 };
    case "highImpact":
      return { unit: "hours", estimate: 4 };
    case "strategic":
      return { unit: "sprints", estimate: 1 };
  }
}

function defaultDeltaForSeverity(
  severity: Recommendation["severity"],
  baselineScore: number,
): number {
  const headroom = Math.max(0, 10 - baselineScore);
  const ideal =
    severity === "quickWin" ? 0.6 : severity === "highImpact" ? 1.5 : 2.5;
  return Math.min(ideal, headroom);
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function enrichRecommendation(
  rec: Recommendation,
  baselineScores: readonly DimensionScore[],
): Recommendation {
  const baseline = baselineScores.find((b) => b.id === rec.dimension);
  const baselineScore = baseline?.score ?? 5;

  const category = rec.category ?? DIMENSION_DEFAULT_CATEGORY[rec.dimension];

  const effort = rec.effort ?? defaultEffortForSeverity(rec.severity);

  const location = rec.location ?? DIMENSION_DEFAULT_LOCATION[rec.dimension];

  let metric = rec.metric ?? null;
  if (metric === null && baseline?.observedValue && baseline?.target) {
    metric = {
      current: baseline.observedValue,
      target: baseline.target,
    };
  }

  const existingImpact = rec.expectedImpact ?? [];
  const hasPrimary = existingImpact.some(
    (e) => e.dimensionId === rec.dimension,
  );
  const expectedImpact = hasPrimary
    ? existingImpact.map((e) => ({ ...e, expectedDelta: r2(e.expectedDelta) }))
    : [
        ...existingImpact.map((e) => ({
          ...e,
          expectedDelta: r2(e.expectedDelta),
        })),
        {
          dimensionId: rec.dimension,
          expectedDelta: r2(defaultDeltaForSeverity(rec.severity, baselineScore)),
          note: `Default projection (${rec.severity}) capped by current gap to 10/10.`,
        },
      ];

  return {
    ...rec,
    category,
    metric,
    expectedImpact,
    effort,
    location,
  };
}

export function totalWeightedImpact(rec: Recommendation): number {
  const items = rec.expectedImpact ?? [];
  return r2(
    items.reduce(
      (acc, e) =>
        acc + (e.expectedDelta * (DIMENSION_WEIGHTS[e.dimensionId] ?? 0)) / 10,
      0,
    ),
  );
}

export interface DeterministicFixCandidate {
  dimension: DimensionId;
  baselineScore: number;
  weight: number;
  gap: string;
  observedValue: string | null;
  target: string | null;
  suggestedFix: string;
  severityHint: Recommendation["severity"];
  failedComponents: string[];
}

export function buildDeterministicFixCandidates(
  baselineScores: readonly DimensionScore[],
): DeterministicFixCandidate[] {
  const candidates: DeterministicFixCandidate[] = [];

  for (const dim of baselineScores) {
    const score = dim.score ?? 0;
    if (score >= 9) continue;

    const failed = (dim.components ?? [])
      .filter((c) => c.passed === false)
      .map((c) =>
        c.detail ? `${c.label}${c.detail ? ` — ${c.detail}` : ""}` : c.label,
      );

    const hasHint = !!dim.improvementHint && dim.improvementHint.trim().length > 0;
    if (!hasHint && failed.length === 0) continue;

    const severityHint: Recommendation["severity"] =
      score < 4 ? "highImpact" : score < 7 ? "highImpact" : "quickWin";

    const observedValue = dim.observedValue ?? null;
    const target = dim.target ?? null;
    const gap =
      observedValue && target
        ? `Current: ${observedValue} → Target: ${target}`
        : (dim.summary ?? "(no observed value)");

    candidates.push({
      dimension: dim.id,
      baselineScore: score,
      weight: dim.weight,
      gap,
      observedValue,
      target,
      suggestedFix: dim.improvementHint ?? "(no deterministic hint)",
      severityHint,
      failedComponents: failed,
    });
  }

  candidates.sort(
    (a, b) =>
      ((10 - b.baselineScore) * b.weight) / 10 -
      ((10 - a.baselineScore) * a.weight) / 10,
  );

  return candidates;
}

export function sortByImpact(items: Recommendation[]): Recommendation[] {
  return [...items].sort(
    (a, b) => totalWeightedImpact(b) - totalWeightedImpact(a),
  );
}
