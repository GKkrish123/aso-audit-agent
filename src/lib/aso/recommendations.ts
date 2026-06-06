import {
  DIMENSION_WEIGHTS,
  type DimensionId,
  type DimensionScore,
  type Recommendation,
  type RecommendationCategory,
} from "@/types/audit";

/**
 * Default category for a recommendation, derived from its dimension. Used
 * when the LLM omits `category`. Designed so that the most common case for
 * a given dimension lands in a sensible bucket without further input.
 */
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

/**
 * Where in App Store Connect (or off-platform) the recommendation needs to
 * be applied. Used to give the user a concrete breadcrumb in the UI when
 * the LLM omits `location`.
 */
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

/**
 * Default effort estimate per severity bucket. The framework defines:
 *   quickWin   = ≤ 30 minutes, no engineering
 *   highImpact = a few hours to days, copy + design or experiment
 *   strategic  = ≥ 1 sprint, roadmap-level work
 * These are the midpoints used when the LLM omits `effort`.
 */
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

/**
 * Default expected score delta per severity bucket. Capped by the current
 * gap-to-ceiling so we never project a rec lifting a 9.5/10 dimension by +2.
 */
function defaultDeltaForSeverity(
  severity: Recommendation["severity"],
  baselineScore: number,
): number {
  const headroom = Math.max(0, 10 - baselineScore);
  const ideal =
    severity === "quickWin" ? 0.6 : severity === "highImpact" ? 1.5 : 2.5;
  return Math.min(ideal, headroom);
}

/** Round to 2 decimals — keeps badges visually tidy. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fill in missing structured proof fields on a Recommendation. Pure function;
 * never mutates input. Always returns a Recommendation where:
 *   - `category` is set
 *   - `expectedImpact` has at least one entry for the primary dimension
 *   - `effort` is set
 *   - `location` is set
 *   - `metric` is set when the baseline dimension exposes observedValue + target
 */
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

/**
 * Sum of expected weighted-score lift across all impacted dimensions.
 * Used in the UI to surface "Overall +X.X/100" on each rec card and to
 * sort each severity bucket by total leverage.
 */
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

/**
 * A deterministic "fix candidate" derived from the scoring engine. We pass
 * these to the LLM as grounding evidence so the recommendations it produces
 * align with the actual data — no inventing problems, no missing obvious wins.
 *
 *   - `dimension`:     which scorecard row this addresses
 *   - `gap`:           the literal observed-vs-target gap from the baseline
 *   - `suggestedFix`:  the dimension's own deterministic improvementHint
 *   - `severity`:      lightweight bucketing hint based on baseline score
 *   - `weight`:        dimension weight % (so the LLM can prioritize)
 */
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

/**
 * Build the deterministic fix candidate set from baseline dimension scores.
 * Surfaces every dimension where score < 9 AND there is a non-null
 * improvementHint OR at least one failed component. Sorted by weight-loss
 * descending so the LLM sees the highest-leverage gaps first.
 */
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

  // Highest weighted-loss first → highest leverage on the overall /100 score.
  candidates.sort(
    (a, b) =>
      ((10 - b.baselineScore) * b.weight) / 10 -
      ((10 - a.baselineScore) * a.weight) / 10,
  );

  return candidates;
}

/**
 * Order recommendations within a single severity bucket by total weighted
 * impact (descending). Highest-leverage fixes surface first in the UI.
 */
export function sortByImpact(items: Recommendation[]): Recommendation[] {
  return [...items].sort(
    (a, b) => totalWeightedImpact(b) - totalWeightedImpact(a),
  );
}
