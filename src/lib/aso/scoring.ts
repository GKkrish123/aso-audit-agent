import {
  DIMENSION_WEIGHTS,
  type AppMetadata,
  type Competitor,
  type DimensionId,
  type DimensionScore,
  type ListingContent,
} from "@/types/audit";

const TITLE_LIMIT = 30;
const SUBTITLE_LIMIT = 30;
const KEYWORD_FIELD_LIMIT = 100;
const SCREENSHOT_TARGET_SLOTS = 10;
const DESCRIPTION_HOOK_CHARS = 170; // ~3 lines on a typical iPhone before "more".

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function weighted(id: DimensionId, score10: number): number {
  return (DIMENSION_WEIGHTS[id] / 10) * score10;
}

function scoreTitle(listing: ListingContent): {
  score: number;
  evidence: string[];
} {
  const title = listing.title.trim();
  const len = title.length;
  const evidence: string[] = [`Title length: ${len}/${TITLE_LIMIT}`];

  let score = 5;
  if (len === 0) {
    evidence.push("Title is empty.");
    return { score: 0, evidence };
  }
  if (len <= 10) score -= 2;
  else if (len < 20) score += 1;
  else if (len <= TITLE_LIMIT) score += 2;
  else {
    score -= 2;
    evidence.push(`Title exceeds the ${TITLE_LIMIT}-character limit.`);
  }

  if (/[:|\-–—]/.test(title)) {
    score += 1;
    evidence.push("Uses a brand/keyword separator.");
  }
  if (/\bapp\b/i.test(title)) {
    score -= 1;
    evidence.push('Title contains the wasted word "app".');
  }
  return { score: clamp(score, 0, 10), evidence };
}

function scoreSubtitle(listing: ListingContent): {
  score: number;
  evidence: string[];
} {
  const subtitle = (listing.subtitle ?? "").trim();
  const evidence: string[] = [];
  if (!subtitle) {
    evidence.push("Subtitle is missing.");
    return { score: 1, evidence };
  }
  const len = subtitle.length;
  evidence.push(`Subtitle length: ${len}/${SUBTITLE_LIMIT}`);
  let score = 4;
  if (len >= 20 && len <= SUBTITLE_LIMIT) score += 3;
  else if (len > SUBTITLE_LIMIT) {
    score -= 2;
    evidence.push(`Subtitle exceeds ${SUBTITLE_LIMIT}-character limit.`);
  } else if (len < 10) {
    score -= 1;
  }

  // Penalise word duplication with the title.
  const titleWords = new Set(
    listing.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
  );
  const dup = subtitle
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && titleWords.has(w));
  if (dup.length > 0) {
    score -= 1;
    evidence.push(
      `Repeats word(s) from title: ${[...new Set(dup)].join(", ")}`,
    );
  }
  return { score: clamp(score, 0, 10), evidence };
}

function scoreKeywordField(): { score: number; evidence: string[] } {
  // The 100-char keyword field is not publicly exposed by Apple. We score
  // structurally based on what we can detect from title/subtitle overlap,
  // and the LLM is responsible for nuancing this with rubric checks.
  return {
    score: 5,
    evidence: [
      `Keyword field (${KEYWORD_FIELD_LIMIT} chars, iOS-only) is not publicly visible; scored heuristically.`,
    ],
  };
}

function scoreDescription(listing: ListingContent): {
  score: number;
  evidence: string[];
} {
  const desc = (listing.description ?? "").trim();
  const evidence: string[] = [];
  if (!desc) {
    evidence.push("Description is empty.");
    return { score: 0, evidence };
  }
  evidence.push(`Description length: ${desc.length} chars`);
  const hook = desc.slice(0, DESCRIPTION_HOOK_CHARS);
  const sentences = hook.split(/[.!?]\s/).filter(Boolean);
  let score = 5;
  if (sentences.length >= 1) score += 1;
  if (/\b(get|try|join|start|discover|listen|watch|book|find)\b/i.test(hook)) {
    score += 1;
    evidence.push("Hook contains a strong verb / CTA.");
  } else {
    evidence.push("Hook lacks a clear CTA verb.");
  }
  if (desc.length > 1500) score += 1;
  if (
    /\b(rated|reviews?|users?|downloads?|trusted|million|billion|loved)\b/i.test(
      desc,
    )
  ) {
    score += 1;
    evidence.push("Includes social proof signals.");
  }
  return { score: clamp(score, 0, 10), evidence };
}

function scoreScreenshots(listing: ListingContent): {
  score: number;
  evidence: string[];
} {
  const slots = listing.screenshotUrls.length;
  const evidence = [`iPhone screenshots used: ${slots}/${SCREENSHOT_TARGET_SLOTS}`];
  if (listing.ipadScreenshotUrls.length > 0) {
    evidence.push(`iPad screenshots used: ${listing.ipadScreenshotUrls.length}`);
  }
  if (slots === 0) {
    return { score: 0, evidence: [...evidence, "No screenshots detected."] };
  }
  let score = Math.round((slots / SCREENSHOT_TARGET_SLOTS) * 8);
  if (slots >= 6) score += 1;
  if (slots >= SCREENSHOT_TARGET_SLOTS) score += 1;
  return { score: clamp(score, 0, 10), evidence };
}

function scoreAppPreviewVideo(listing: ListingContent): {
  score: number;
  evidence: string[];
} {
  if (!listing.hasAppPreviewVideo) {
    return {
      score: 2,
      evidence: ["No app preview video detected on the listing."],
    };
  }
  return {
    score: 7,
    evidence: [
      `App preview video present (${listing.appPreviewVideoUrls.length} variant(s)).`,
    ],
  };
}

function scoreRatingsAndReviews(meta: AppMetadata): {
  score: number;
  evidence: string[];
} {
  const evidence: string[] = [];
  const rating = meta.averageUserRating ?? 0;
  const count = meta.userRatingCount ?? 0;
  evidence.push(`Average rating: ${rating.toFixed(2)} (${count} ratings)`);
  let score = 3;
  if (rating >= 4.7) score = 9;
  else if (rating >= 4.5) score = 8;
  else if (rating >= 4.2) score = 7;
  else if (rating >= 4.0) score = 6;
  else if (rating >= 3.5) score = 4;
  if (count > 1_000_000) score += 1;
  if (count < 100) {
    score -= 2;
    evidence.push("Very low rating volume reduces social-proof signal.");
  }
  return { score: clamp(score, 0, 10), evidence };
}

function scoreIcon(meta: AppMetadata): { score: number; evidence: string[] } {
  if (!meta.artworkUrl) {
    return { score: 2, evidence: ["No artwork URL found."] };
  }
  return {
    score: 7,
    evidence: [
      "Icon present. Visual distinctiveness should be reviewed against category competitors.",
    ],
  };
}

function scoreConversionSignals(listing: ListingContent): {
  score: number;
  evidence: string[];
} {
  const signals: string[] = [];
  if (listing.promotionalText) signals.push("promotional text");
  if (listing.releaseNotes) signals.push('"what\'s new"');
  const score = Math.min(10, 3 + signals.length * 3);
  return {
    score,
    evidence: [
      signals.length
        ? `Detected signals: ${signals.join(", ")}.`
        : "No promotional text or release notes detected.",
    ],
  };
}

function scoreCompetitivePosition(
  meta: AppMetadata,
  competitors: Competitor[],
): { score: number; evidence: string[] } {
  if (!competitors.length) {
    return {
      score: 5,
      evidence: ["No competitor data available; scored as neutral."],
    };
  }
  const ratings = competitors
    .map((c) => c.averageUserRating)
    .filter((r): r is number => typeof r === "number");
  const avgCompetitorRating =
    ratings.reduce((a, b) => a + b, 0) / Math.max(1, ratings.length);
  const myRating = meta.averageUserRating ?? 0;
  const delta = myRating - avgCompetitorRating;
  const evidence = [
    `Top competitors avg rating: ${avgCompetitorRating.toFixed(2)} | this app: ${myRating.toFixed(2)} (delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}).`,
  ];
  const score = 5 + Math.round(delta * 2);
  return { score: clamp(score, 0, 10), evidence };
}

export function computeBaselineScores(input: {
  metadata: AppMetadata;
  listing: ListingContent;
  competitors: Competitor[];
}): DimensionScore[] {
  const { metadata, listing, competitors } = input;
  const compute = (
    id: DimensionId,
    res: { score: number; evidence: string[] },
    summary: string,
  ): DimensionScore => ({
    id,
    score: res.score,
    weight: DIMENSION_WEIGHTS[id],
    weightedScore: weighted(id, res.score),
    summary,
    evidence: res.evidence,
  });

  return [
    compute(
      "title",
      scoreTitle(listing),
      "Heuristic score based on length, separator usage, and wasted-word detection.",
    ),
    compute(
      "subtitle",
      scoreSubtitle(listing),
      "Heuristic score based on length and title-overlap detection.",
    ),
    compute(
      "keywordField",
      scoreKeywordField(),
      "Structural score; the actual 100-char keyword field is not publicly readable.",
    ),
    compute(
      "description",
      scoreDescription(listing),
      "Heuristic score based on hook strength, length, and social-proof signals.",
    ),
    compute(
      "screenshots",
      scoreScreenshots(listing),
      "Score reflects slot utilization (up to 10).",
    ),
    compute(
      "appPreviewVideo",
      scoreAppPreviewVideo(listing),
      "Presence-based score; refine qualitatively with the LLM.",
    ),
    compute(
      "ratingsAndReviews",
      scoreRatingsAndReviews(metadata),
      "Based on average rating and rating volume from iTunes API.",
    ),
    compute(
      "icon",
      scoreIcon(metadata),
      "Presence-based; LLM should refine using category fit and distinctiveness.",
    ),
    compute(
      "conversionSignals",
      scoreConversionSignals(listing),
      "Detects promotional text and what\u2019s new presence.",
    ),
    compute(
      "competitivePosition",
      scoreCompetitivePosition(metadata, competitors),
      "Compares average rating against top competitors in the same category.",
    ),
  ];
}

export function aggregateOverallScore(scores: DimensionScore[]): number {
  const total = scores.reduce((acc, s) => acc + s.weightedScore, 0);
  return Math.round(clamp(total, 0, 100));
}
