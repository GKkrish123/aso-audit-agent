import type {
  AppMetadata,
  Competitor,
  CompetitorComparisonRow,
} from "@/types/audit";

/**
 * Build the Competitor Comparison rows for the audit report.
 *
 * 100% deterministic — every value (rating delta, volume ratio, strengths,
 * weaknesses, notes, source pill) is derived directly from iTunes payload +
 * the competitor scanner's metadata. No LLM is asked to fabricate numbers,
 * so the rendered table is guaranteed accurate and survives an LLM outage.
 *
 * Decisions encoded:
 *  - Same-developer apps in the input are dropped (they aren't real competition).
 *  - Sort order mirrors the scanner's composite ranking; we tie-break on volume.
 *  - Deltas use absolute thresholds (rating Δ ≥ 0.05★, volume ratio ≥ 1.5×)
 *    so the strengths/weaknesses pills only fire for *material* differences,
 *    not statistical noise.
 *  - `notes` is a single human-readable one-liner that the UI can show as
 *    fine print without further formatting.
 */
export function buildCompetitorComparison(
  meta: AppMetadata,
  competitors: readonly Competitor[],
): CompetitorComparisonRow[] {
  if (competitors.length === 0) return [];

  const myArtist = meta.artistName.trim().toLowerCase();
  const myRating = meta.averageUserRating ?? null;
  const myCount = meta.userRatingCount ?? null;

  const rows = competitors
    .filter((c) => c.artistName.trim().toLowerCase() !== myArtist)
    .map((c) => toRow(c, myRating, myCount));

  // Stable order: composite similarity (highest first), then volume.
  rows.sort((a, b) => {
    const aSim = a.compositeSimilarity ?? a.keywordOverlap;
    const bSim = b.compositeSimilarity ?? b.keywordOverlap;
    if (bSim !== aSim) return bSim - aSim;
    return (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
  });

  return rows;
}

function toRow(
  c: Competitor,
  myRating: number | null,
  myCount: number | null,
): CompetitorComparisonRow {
  const ratingDelta =
    myRating !== null && c.averageUserRating !== null
      ? roundTo(myRating - c.averageUserRating, 2)
      : null;
  const ratingCountRatio =
    myCount !== null && c.userRatingCount !== null && c.userRatingCount > 0
      ? roundTo(myCount / c.userRatingCount, 2)
      : null;

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  // Rating comparison (threshold 0.05★ avoids noise from rounding).
  if (ratingDelta !== null && Math.abs(ratingDelta) >= 0.05) {
    if (ratingDelta < 0) {
      // they beat me
      strengths.push(
        `Higher rating (${formatRating(c.averageUserRating)}★ vs ${formatRating(myRating)}★ — Δ ${ratingDelta.toFixed(2)})`,
      );
    } else {
      // I beat them
      weaknesses.push(
        `Lower rating (${formatRating(c.averageUserRating)}★ vs ${formatRating(myRating)}★ — Δ +${ratingDelta.toFixed(2)})`,
      );
    }
  } else if (ratingDelta !== null) {
    // Within 0.05 — call out parity explicitly.
    weaknesses.push(
      `Rating at parity (${formatRating(c.averageUserRating)}★ vs ${formatRating(myRating)}★)`,
    );
  }

  // Volume comparison (threshold 1.5×).
  if (ratingCountRatio !== null) {
    if (ratingCountRatio >= 1.5) {
      // I'm bigger
      weaknesses.push(
        `Smaller audience (${formatCount(c.userRatingCount)} ratings — ${ratingCountRatio.toFixed(2)}× smaller than you)`,
      );
    } else if (ratingCountRatio > 0 && ratingCountRatio <= 1 / 1.5) {
      // They're bigger
      const flipped = roundTo(1 / ratingCountRatio, 2);
      strengths.push(
        `Larger audience (${formatCount(c.userRatingCount)} ratings — ${flipped.toFixed(2)}× more than you)`,
      );
    }
  } else if (c.userRatingCount !== null && c.userRatingCount > 0 && myCount !== null && myCount === 0) {
    strengths.push(
      `Established audience (${formatCount(c.userRatingCount)} ratings; you have 0)`,
    );
  }

  // Chart presence is the strongest "real category competitor" signal we have.
  if (
    c.chartRank !== undefined &&
    (c.source === "top-free-chart" || c.source === "top-grossing-chart")
  ) {
    const chartLabel =
      c.source === "top-free-chart" ? "free chart" : "grossing chart";
    const where = c.primaryGenreName
      ? `${c.primaryGenreName} ${chartLabel}`
      : chartLabel;
    strengths.push(`Top ${c.chartRank} in ${where}`);
  }

  // Keyword overlap as a strength only when notably high (≥40% — Jaccard is
  // strict; 40%+ means the listings share major terminology).
  if (c.overlapScore >= 0.4) {
    strengths.push(
      `Targets the same keywords (${pct(c.overlapScore)} listing overlap)`,
    );
  }

  return {
    competitorAppId: c.appId,
    competitorName: c.trackName,
    developerName: c.artistName,
    category: c.primaryGenreName ?? null,
    appStoreUrl: c.appStoreUrl,
    rating: c.averageUserRating,
    ratingCount: c.userRatingCount,
    ratingDelta,
    ratingCountRatio,
    keywordOverlap: roundTo(c.overlapScore, 4),
    compositeSimilarity:
      typeof c.compositeScore === "number"
        ? roundTo(c.compositeScore, 4)
        : null,
    source: c.source ?? null,
    chartRank: c.chartRank ?? null,
    strengths,
    weaknesses,
    notes: buildNotes(c, ratingDelta, ratingCountRatio),
  };
}

/**
 * One-line human-readable summary suitable for fine print under the card.
 * Always non-empty so the UI can show it without further checks.
 *
 * Format: `<source-tag> • <volume> ratings @ <rating>★ • <vs-you-clause>`
 */
function buildNotes(
  c: Competitor,
  ratingDelta: number | null,
  ratingCountRatio: number | null,
): string {
  const parts: string[] = [];

  if (
    c.chartRank !== undefined &&
    (c.source === "top-free-chart" || c.source === "top-grossing-chart")
  ) {
    const chartLabel =
      c.source === "top-free-chart" ? "free" : "grossing";
    parts.push(
      `Top-${c.chartRank} ${c.primaryGenreName ?? ""} (${chartLabel} chart)`.trim(),
    );
  } else if (c.source === "genre-search") {
    parts.push(`Genre peer${c.primaryGenreName ? ` — ${c.primaryGenreName}` : ""}`);
  } else if (c.source === "subgenre-search") {
    parts.push(
      `Sub-genre peer${c.primaryGenreName ? ` — ${c.primaryGenreName}` : ""}`,
    );
  } else if (c.source === "term-search") {
    parts.push("Surfaced by keyword search");
  }

  const ratingTxt = `${formatCount(c.userRatingCount)} ratings @ ${formatRating(c.averageUserRating)}★`;
  parts.push(ratingTxt);

  const vsClause = vsYouClause(ratingDelta, ratingCountRatio);
  if (vsClause) parts.push(vsClause);

  return parts.join(" • ");
}

function vsYouClause(
  ratingDelta: number | null,
  ratingCountRatio: number | null,
): string | null {
  const fragments: string[] = [];
  if (ratingDelta !== null) {
    if (ratingDelta <= -0.05) {
      fragments.push(`${Math.abs(ratingDelta).toFixed(2)}★ ahead of you`);
    } else if (ratingDelta >= 0.05) {
      fragments.push(`${ratingDelta.toFixed(2)}★ behind you`);
    }
  }
  if (ratingCountRatio !== null) {
    if (ratingCountRatio >= 1.5) {
      fragments.push(`${ratingCountRatio.toFixed(2)}× your volume`);
    } else if (ratingCountRatio > 0 && ratingCountRatio <= 1 / 1.5) {
      const flipped = roundTo(1 / ratingCountRatio, 2);
      fragments.push(`${flipped.toFixed(2)}× larger than you`);
    }
  }
  return fragments.length === 0 ? null : fragments.join(", ");
}

function roundTo(n: number, places: number): number {
  const m = 10 ** places;
  return Math.round(n * m) / m;
}

function formatRating(r: number | null): string {
  return r === null ? "—" : r.toFixed(2);
}

function formatCount(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString();
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
