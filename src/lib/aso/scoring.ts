import {
  DIMENSION_WEIGHTS,
  type AppMetadata,
  type Competitor,
  type DimensionId,
  type DimensionScore,
  type ListingContent,
  type ScoreComponent,
} from "@/types/audit";

/* ────────────────────────────────────────────────────────────────────────────
 * Apple App Store hard limits + product-research benchmarks (sources):
 *  - Title:      30 chars (hard cap)
 *  - Subtitle:   30 chars (hard cap, iOS 11+)
 *  - Keyword field: 100 chars, comma-separated, iOS-only, NOT publicly readable
 *  - Description: up to 4000 chars
 *  - Hook (above "more" fold): ~170 chars on iPhone
 *  - Screenshots: up to 10 per device class, ≥3 required, ≥6 recommended
 *  - App preview videos: up to 3, 15-30s each
 * ────────────────────────────────────────────────────────────────────────── */

const TITLE_LIMIT = 30;
const SUBTITLE_LIMIT = 30;
const KEYWORD_FIELD_LIMIT = 100;
const SCREENSHOT_TARGET_SLOTS = 10;
const SCREENSHOT_RECOMMENDED = 6;
const SCREENSHOT_MIN = 3;
const DESCRIPTION_HOOK_CHARS = 170;
const DESCRIPTION_HEALTHY_MIN = 1500;

const WASTED_WORDS = new Set([
  "app",
  "apps",
  "application",
  "applications",
  "the",
  "free",
  "best",
  "official",
]);

/** CTA verbs that genuinely pull users into the listing (whitelist, not stuffed). */
const CTA_VERBS = [
  "get",
  "try",
  "join",
  "start",
  "discover",
  "listen",
  "watch",
  "book",
  "find",
  "explore",
  "shop",
  "play",
  "learn",
  "create",
  "manage",
  "track",
  "build",
] as const;

/** Phrases that signal social proof. We capture the *matched literal* as evidence. */
const SOCIAL_PROOF_PATTERNS: ReadonlyArray<RegExp> = [
  /\b\d{1,3}(?:[\s,])?(?:million|billion|m|b)\+?\s+(?:users?|downloads?|listeners?|customers?|members?)\b/i,
  /\b(?:trusted|loved|used)\s+by\s+\d/i,
  /\b\d(?:\.\d)?\s*★|\b\d(?:\.\d)?\s*stars?\b/i,
  /\b(?:featured|editors?[' ]?\s*choice)\b/i,
  /\b(?:#1|top[\s-]?rated|award[\s-]?winning|best\s+app)\b/i,
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function weighted(id: DimensionId, score10: number): number {
  return (DIMENSION_WEIGHTS[id] / 10) * score10;
}

/** Tokenize on word boundaries; lowercase; drop empties. Used by overlap rules. */
function tokensOf(s: string): string[] {
  return s.toLowerCase().split(/[\W_]+/).filter(Boolean);
}

/** Stable short truncation for `observedValue` strings displayed in the UI. */
function truncate(s: string, max = 220): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function joinHint(
  pieces: ReadonlyArray<string | false | null | undefined>,
): string | null {
  const kept = pieces.filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  if (kept.length === 0) return null;
  return `${kept.join("; ")}.`;
}

/** Linear interpolated median; resilient to even/odd sample sizes. */
function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Mid-rank percentile of `value` within `sample`. Returns 0..1 where 1.0 = top
 * of distribution. Ties are split evenly (mid-rank), which keeps a 5-of-5 tie
 * at 0.5 rather than 1.0 — important for fairness when many peers share a rating.
 */
function percentileOf(value: number, sample: readonly number[]): number {
  if (sample.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of sample) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return (below + equal / 2) / sample.length;
}

/** log10 with floor at 1 — handles 0/negative counts gracefully. */
function logCount(n: number): number {
  return Math.log10(Math.max(1, n));
}

interface Computed {
  score: number;
  baseline: number;
  components: ScoreComponent[];
  observedValue: string | null;
  target: string | null;
  source: DimensionScore["source"];
  confidence: NonNullable<DimensionScore["confidence"]>;
  summary: string;
  improvementHint: string | null;
  evidence: string[];
}

function applyComponents(baseline: number, components: ScoreComponent[]): number {
  const raw = components.reduce((acc, c) => acc + c.contribution, baseline);
  return clamp(Math.round(raw * 10) / 10, 0, 10);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-dimension scorers. Each returns a Computed result with:
 *  - the literal observed value (proof)
 *  - the ordered components that built the score (proof trail)
 *  - a dynamic summary written with this app's numbers
 *  - an improvement hint when score < 9
 *  - confidence and source metadata
 * ────────────────────────────────────────────────────────────────────────── */

function scoreTitle(listing: ListingContent): Computed {
  const title = listing.title.trim();
  const len = title.length;
  const baseline = 5;
  const components: ScoreComponent[] = [];

  if (len === 0) {
    return {
      score: 0,
      baseline,
      components: [
        { label: "Title is empty", contribution: -5, passed: false },
      ],
      observedValue: null,
      target: `1-${TITLE_LIMIT} chars (Apple hard cap)`,
      source: "merged",
      confidence: "deterministic",
      summary: "Title is missing — this is the single most important ranking signal.",
      improvementHint: `Set a 20-30 character title combining brand + 1-2 keywords (e.g. "BrandName: Primary Keyword").`,
      evidence: ["Title field is empty."],
    };
  }

  // Length grading — Apple caps at 30, sweet spot 20-30 for keyword room.
  let lengthBand: string;
  let lengthContribution: number;
  if (len > TITLE_LIMIT) {
    lengthBand = `exceeds ${TITLE_LIMIT}-char cap`;
    lengthContribution = -3;
  } else if (len >= 20) {
    lengthBand = `sweet spot 20-${TITLE_LIMIT}`;
    lengthContribution = 2;
  } else if (len >= 12) {
    lengthBand = "short but acceptable";
    lengthContribution = 1;
  } else if (len >= 5) {
    lengthBand = "very short — wastes ranking real estate";
    lengthContribution = -1;
  } else {
    lengthBand = "tiny";
    lengthContribution = -2;
  }
  components.push({
    label: `Length ${len}/${TITLE_LIMIT} (${lengthBand})`,
    contribution: lengthContribution,
    passed: lengthContribution > 0,
    detail: title,
  });

  /**
   * Brand/keyword separator detection — must be surrounded by whitespace
   * (or be a typographic dash) so we don't false-positive on compound
   * words like "Wake-Up Light" or hyphenated brand names.
   */
  const separatorMatch = title.match(
    /(?:\s[:|\-–—]\s|\s[:|]|[:|]\s|\s[—–]\s)/,
  );
  if (separatorMatch) {
    components.push({
      label: "Uses brand/keyword separator",
      contribution: 1,
      passed: true,
      detail: `Separator: "${separatorMatch[0].trim()}"`,
    });
  }

  // Wasted-word detection — tokenize first so "appendix" doesn't trigger "app".
  const wasted = tokensOf(title).filter((t) => WASTED_WORDS.has(t));
  if (wasted.length > 0) {
    components.push({
      label: `Contains wasted word(s): ${[...new Set(wasted)].join(", ")}`,
      contribution: -1 * Math.min(2, wasted.length),
      passed: false,
      detail: `Burns ranking-relevant characters on filler.`,
    });
  }

  // Keyword-stuffing heuristic — too many distinct content tokens reads spammy.
  const contentTokens = tokensOf(title).filter((t) => t.length > 3 && !WASTED_WORDS.has(t));
  if (contentTokens.length >= 5) {
    components.push({
      label: `Keyword-stuffed (${contentTokens.length} content tokens)`,
      contribution: -1,
      passed: false,
      detail: `Reads as a keyword dump; Apple may demote.`,
    });
  }

  const score = applyComponents(baseline, components);

  const summaryParts = [`Title is ${len}/${TITLE_LIMIT} chars`];
  if (separatorMatch) summaryParts.push("uses a brand/keyword separator");
  if (wasted.length > 0) summaryParts.push(`includes wasted word(s) "${wasted.join('", "')}"`);

  let hint: string | null = null;
  if (score < 9) {
    const pieces: string[] = [];
    if (len > TITLE_LIMIT) pieces.push(`trim to ≤${TITLE_LIMIT} chars`);
    else if (len < 20) pieces.push(`expand toward the 20-${TITLE_LIMIT}-char sweet spot with a keyword phrase`);
    if (!separatorMatch) pieces.push(`add a brand-keyword separator (":" or " - ")`);
    if (wasted.length > 0) pieces.push(`remove the wasted word(s) "${wasted.join('", "')}"`);
    hint = pieces.length > 0 ? `${pieces.join("; ")}.` : null;
  }

  return {
    score,
    baseline,
    components,
    observedValue: title,
    target: `≤ ${TITLE_LIMIT} chars (Apple hard cap), sweet spot 20-${TITLE_LIMIT}`,
    source: "merged",
    confidence: "deterministic",
    summary: `${summaryParts.join(", ")}.`,
    improvementHint: hint,
    evidence: components.map(
      (c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`,
    ),
  };
}

function scoreSubtitle(
  listing: ListingContent,
  metadata: AppMetadata,
): Computed {
  const subtitle = (listing.subtitle ?? "").trim();
  const target = `≤ ${SUBTITLE_LIMIT} chars (Apple hard cap), sweet spot 20-${SUBTITLE_LIMIT}`;

  if (!subtitle) {
    return {
      score: 1,
      baseline: 1,
      components: [
        { label: "Subtitle is missing", contribution: 0, passed: false },
      ],
      observedValue: null,
      target,
      source: "merged",
      confidence: "deterministic",
      summary: "Subtitle is missing — this is dedicated keyword real estate Apple weights highly.",
      improvementHint: `Add a 20-${SUBTITLE_LIMIT} char subtitle that names 2-3 high-volume keywords without repeating the brand.`,
      evidence: ["Subtitle field is empty."],
    };
  }

  const baseline = 4;
  const components: ScoreComponent[] = [];
  const len = subtitle.length;

  let lengthBand: string;
  let lengthContribution: number;
  if (len > SUBTITLE_LIMIT) {
    lengthBand = `exceeds ${SUBTITLE_LIMIT}-char cap`;
    lengthContribution = -2;
  } else if (len >= 20) {
    lengthBand = `sweet spot 20-${SUBTITLE_LIMIT}`;
    lengthContribution = 3;
  } else if (len >= 10) {
    lengthBand = "underutilized";
    lengthContribution = 0;
  } else {
    lengthBand = "too short";
    lengthContribution = -1;
  }
  components.push({
    label: `Length ${len}/${SUBTITLE_LIMIT} (${lengthBand})`,
    contribution: lengthContribution,
    passed: lengthContribution > 0,
    detail: subtitle,
  });

  /**
   * Title overlap — but exclude the brand-name tokens. Repeating "Spotify"
   * across title + subtitle is normal brand reinforcement, NOT keyword
   * waste; we only penalize *content* duplication.
   */
  const brandTokens = new Set([
    ...tokensOf(metadata.artistName ?? "").filter((t) => t.length > 2),
    ...tokensOf(metadata.trackName).filter((t) => t.length > 4),
  ]);
  const titleContentTokens = new Set(
    tokensOf(listing.title).filter(
      (t) => t.length > 3 && !WASTED_WORDS.has(t) && !brandTokens.has(t),
    ),
  );
  const dup = tokensOf(subtitle).filter(
    (t) => t.length > 3 && titleContentTokens.has(t),
  );
  const uniqueDup = [...new Set(dup)];
  if (uniqueDup.length > 0) {
    components.push({
      label: `Repeats non-brand title word(s): ${uniqueDup.join(", ")}`,
      contribution: -1,
      passed: false,
      detail: `Wasted keyword slots — these tokens already index from the title.`,
    });
  }

  // Wasted words in the subtitle waste even more than in the title (smaller field).
  const wasted = tokensOf(subtitle).filter((t) => WASTED_WORDS.has(t));
  if (wasted.length > 0) {
    components.push({
      label: `Contains wasted word(s): ${[...new Set(wasted)].join(", ")}`,
      contribution: -1,
      passed: false,
    });
  }

  const score = applyComponents(baseline, components);

  let hint: string | null = null;
  if (score < 9) {
    const pieces: string[] = [];
    if (len > SUBTITLE_LIMIT) pieces.push(`trim to ≤${SUBTITLE_LIMIT} chars`);
    else if (len < 20) pieces.push(`expand to 20-${SUBTITLE_LIMIT} chars with 2-3 high-volume keywords`);
    if (uniqueDup.length > 0)
      pieces.push(`swap "${uniqueDup.join('", "')}" for keywords not already in the title`);
    if (wasted.length > 0)
      pieces.push(`drop wasted word(s) "${wasted.join('", "')}"`);
    hint = pieces.length > 0 ? `${pieces.join("; ")}.` : null;
  }

  return {
    score,
    baseline,
    components,
    observedValue: subtitle,
    target,
    source: "merged",
    confidence: "deterministic",
    summary:
      `Subtitle is ${len}/${SUBTITLE_LIMIT} chars` +
      (uniqueDup.length > 0
        ? `, duplicates ${uniqueDup.length} non-brand title token(s).`
        : ", no non-brand overlap with title."),
    improvementHint: hint,
    evidence: components.map(
      (c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`,
    ),
  };
}

function scoreKeywordField(listing: ListingContent): Computed {
  /**
   * The 100-char keyword field is iOS-only and not publicly readable through
   * any official endpoint. We score *indirectly* by checking whether title +
   * subtitle look like they were optimized assuming the keyword field exists
   * (i.e. they don't dump every keyword into visible copy).
   */
  const baseline = 5;
  const components: ScoreComponent[] = [];
  const title = listing.title.trim();
  const subtitle = (listing.subtitle ?? "").trim();
  const visibleLen = title.length + subtitle.length;

  components.push({
    label: `Visible title + subtitle: ${visibleLen} chars`,
    contribution: 0,
    passed: true,
    detail: `Together they index alongside the hidden ${KEYWORD_FIELD_LIMIT}-char keyword field.`,
  });

  if (subtitle.length === 0) {
    components.push({
      label: "Subtitle is empty",
      contribution: -2,
      passed: false,
      detail: "Without a subtitle the keyword field has to do double duty.",
    });
  }
  if (subtitle.length > 0 && tokensOf(subtitle).length >= 3) {
    components.push({
      label: "Subtitle carries multiple distinct keywords",
      contribution: 2,
      passed: true,
    });
  }

  const score = applyComponents(baseline, components);

  return {
    score,
    baseline,
    components,
    observedValue: null,
    target: `${KEYWORD_FIELD_LIMIT}-char hidden field, comma-separated keywords`,
    source: "computed",
    confidence: "heuristic",
    summary:
      `Keyword field is not publicly readable; scored heuristically from title + subtitle posture` +
      (subtitle.length === 0 ? " (subtitle missing weakens this dimension)." : "."),
    improvementHint:
      "Use the keyword field for singular keywords NOT already in title/subtitle, comma-separated, no spaces.",
    evidence: components.map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`),
  };
}

function scoreDescription(listing: ListingContent): Computed {
  const desc = (listing.description ?? "").trim();
  const target = `≥ ${DESCRIPTION_HEALTHY_MIN} chars, strong hook in first ${DESCRIPTION_HOOK_CHARS} chars`;

  if (!desc) {
    return {
      score: 0,
      baseline: 0,
      components: [{ label: "Description is empty", contribution: 0, passed: false }],
      observedValue: null,
      target,
      source: listing.sources.longText === "none" ? null : listing.sources.longText,
      confidence: "deterministic",
      summary: "Description is empty — conversion-killer.",
      improvementHint: `Write at least ${DESCRIPTION_HEALTHY_MIN} chars; lead with the value prop in the first ${DESCRIPTION_HOOK_CHARS} chars.`,
      evidence: ["Description field is empty."],
    };
  }

  const baseline = 4;
  const components: ScoreComponent[] = [];
  const hook = desc.slice(0, DESCRIPTION_HOOK_CHARS);
  const hookSentences = hook.split(/[.!?](?:\s|$)/).filter(Boolean);

  components.push({
    label: `Description length: ${desc.length} chars`,
    contribution: desc.length >= DESCRIPTION_HEALTHY_MIN ? 1 : -1,
    passed: desc.length >= DESCRIPTION_HEALTHY_MIN,
    detail:
      desc.length >= DESCRIPTION_HEALTHY_MIN
        ? `Healthy length (target ≥${DESCRIPTION_HEALTHY_MIN}).`
        : `Below ${DESCRIPTION_HEALTHY_MIN}-char healthy minimum.`,
  });

  components.push({
    label: `Hook has ${hookSentences.length} sentence(s) in first ${DESCRIPTION_HOOK_CHARS} chars`,
    contribution: hookSentences.length >= 1 ? 1 : 0,
    passed: hookSentences.length >= 1,
    detail: truncate(hook, 200),
  });

  const ctaMatch = CTA_VERBS.find((v) =>
    new RegExp(`\\b${v}\\b`, "i").test(hook),
  );
  components.push({
    label: ctaMatch
      ? `Hook contains CTA verb "${ctaMatch}"`
      : "Hook lacks a clear CTA verb",
    contribution: ctaMatch ? 1 : -1,
    passed: !!ctaMatch,
    detail: ctaMatch ? undefined : `Whitelist: ${CTA_VERBS.slice(0, 6).join(", ")}…`,
  });

  const proofMatches: string[] = [];
  for (const re of SOCIAL_PROOF_PATTERNS) {
    const m = desc.match(re);
    if (m) proofMatches.push(m[0]);
  }
  if (proofMatches.length > 0) {
    components.push({
      label: `Social proof signals detected (${proofMatches.length})`,
      contribution: Math.min(2, proofMatches.length),
      passed: true,
      detail: proofMatches.slice(0, 3).map((m) => `"${m}"`).join(", "),
    });
  } else {
    components.push({
      label: "No social proof signals detected",
      contribution: -1,
      passed: false,
      detail: "Add user counts, ratings, or press mentions.",
    });
  }

  const hasStructure = /(\n[•\-*]\s|\n#+\s|\n\s*[A-Z][A-Z\s]{6,}\n)/.test(desc);
  components.push({
    label: hasStructure
      ? "Description uses structural cues (bullets/headers)"
      : "Description is a wall of text — no bullets/headers detected",
    contribution: hasStructure ? 1 : -1,
    passed: hasStructure,
  });

  const score = applyComponents(baseline, components);

  const hint =
    score < 9
      ? joinHint([
          hookSentences.length === 0 && "open with a complete sentence in the first 170 chars",
          !ctaMatch && "lead the hook with a CTA verb (Try, Get, Start, Discover, …)",
          proofMatches.length === 0 && "add social proof (user count, rating, press mention)",
          desc.length < DESCRIPTION_HEALTHY_MIN && `expand to \u2265${DESCRIPTION_HEALTHY_MIN} chars`,
          !hasStructure && "break up dense paragraphs with bullets or short headers",
        ])
      : null;

  return {
    score,
    baseline,
    components,
    observedValue: truncate(hook, 220),
    target,
    source: listing.sources.longText === "none" ? null : listing.sources.longText,
    confidence: "deterministic",
    summary: `Description is ${desc.length} chars with ${hookSentences.length} hook sentence(s)${
      ctaMatch ? `, leads with CTA "${ctaMatch}"` : ", no CTA in hook"
    }; ${proofMatches.length} social-proof signal(s).`,
    improvementHint: hint,
    evidence: components.map(
      (c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`,
    ),
  };
}

function scoreScreenshots(listing: ListingContent): Computed {
  const iphone = listing.screenshotUrls.length;
  const ipad = listing.ipadScreenshotUrls.length;
  const target = `${SCREENSHOT_MIN}-${SCREENSHOT_TARGET_SLOTS} iPhone slots (Apple cap), ≥${SCREENSHOT_RECOMMENDED} recommended`;

  if (iphone === 0) {
    return {
      score: 0,
      baseline: 0,
      components: [
        { label: "No iPhone screenshots detected", contribution: 0, passed: false },
      ],
      observedValue: null,
      target,
      source: listing.sources.screenshots === "none" ? null : listing.sources.screenshots,
      confidence: "needs_visual_review",
      summary: "No screenshots — listing will not convert.",
      improvementHint: `Upload at least ${SCREENSHOT_MIN} (ideally ${SCREENSHOT_TARGET_SLOTS}) iPhone screenshots; lead with the strongest value prop.`,
      evidence: ["No iPhone screenshots."],
    };
  }

  const baseline = 0;
  const components: ScoreComponent[] = [];
  components.push({
    label: `iPhone slots used: ${iphone}/${SCREENSHOT_TARGET_SLOTS}`,
    contribution: Math.round((iphone / SCREENSHOT_TARGET_SLOTS) * 7 * 10) / 10,
    passed: iphone >= SCREENSHOT_MIN,
    detail:
      iphone >= SCREENSHOT_TARGET_SLOTS
        ? "Slots fully utilized."
        : iphone >= SCREENSHOT_RECOMMENDED
          ? "Above recommended floor."
          : iphone >= SCREENSHOT_MIN
            ? "Above hard minimum but below recommended."
            : "Below Apple's recommended minimum.",
  });
  if (iphone >= SCREENSHOT_RECOMMENDED) {
    components.push({
      label: `≥${SCREENSHOT_RECOMMENDED} screenshots`,
      contribution: 1,
      passed: true,
    });
  }
  if (iphone >= SCREENSHOT_TARGET_SLOTS) {
    components.push({
      label: "Maxed out slots (10/10)",
      contribution: 1,
      passed: true,
    });
  }
  if (ipad > 0) {
    components.push({
      label: `iPad screenshots present (${ipad})`,
      contribution: 1,
      passed: true,
      detail: "Demonstrates iPad-optimized UI.",
    });
  }

  const score = applyComponents(baseline, components);

  const hint =
    score < 9
      ? joinHint([
          iphone < SCREENSHOT_TARGET_SLOTS &&
            `add ${SCREENSHOT_TARGET_SLOTS - iphone} more iPhone screenshot(s) to max the slot count`,
          ipad === 0 && "add iPad screenshots if the app supports iPad",
        ])
      : null;

  return {
    score,
    baseline,
    components,
    observedValue: `${iphone} iPhone${ipad > 0 ? `, ${ipad} iPad` : ""}`,
    target,
    source: listing.sources.screenshots === "none" ? null : listing.sources.screenshots,
    // Slot count is deterministic, but visual quality (copy, hierarchy) needs eyes.
    confidence: "needs_visual_review",
    summary: `${iphone}/${SCREENSHOT_TARGET_SLOTS} iPhone slots used${
      ipad > 0 ? `, ${ipad} iPad screenshot(s)` : ""
    }. Visual quality still requires human/LLM review.`,
    improvementHint: hint,
    evidence: components.map(
      (c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`,
    ),
  };
}

function scoreAppPreviewVideo(listing: ListingContent): Computed {
  const present = listing.hasAppPreviewVideo;
  const variants = listing.appPreviewVideoUrls.length;
  const target = "1-3 app preview videos, 15-30s each";

  if (!present) {
    return {
      score: 2,
      baseline: 2,
      components: [
        { label: "No app preview video detected", contribution: 0, passed: false },
      ],
      observedValue: null,
      target,
      source: listing.sources.screenshots === "none" ? null : listing.sources.screenshots,
      confidence: "deterministic",
      summary: "No app preview video — preview videos lift conversion 20-25% on average.",
      improvementHint:
        "Produce a 15-30s app preview video showing the core flow in the first 3 seconds.",
      evidence: ["No app preview video URLs returned."],
    };
  }

  const baseline = 6;
  const components: ScoreComponent[] = [
    {
      label: `App preview video present (${variants} variant${variants === 1 ? "" : "s"})`,
      contribution: 1,
      passed: true,
    },
  ];
  if (variants >= 3) {
    components.push({
      label: "Maxed video slots (3)",
      contribution: 1,
      passed: true,
    });
  }
  const score = applyComponents(baseline, components);

  return {
    score,
    baseline,
    components,
    observedValue: `${variants} preview video${variants === 1 ? "" : "s"}`,
    target,
    source: listing.sources.screenshots === "none" ? null : listing.sources.screenshots,
    confidence: "needs_visual_review",
    summary: `Preview video present (${variants} variant${variants === 1 ? "" : "s"}); first 3 seconds & retention still need a human/LLM review.`,
    improvementHint:
      variants < 3
        ? `Add ${3 - variants} more preview video(s) to use all 3 slots (per-locale if possible).`
        : null,
    evidence: components.map((c) => c.label),
  };
}

function scoreRatingsAndReviews(meta: AppMetadata): Computed {
  const rating = meta.averageUserRating ?? 0;
  const count = meta.userRatingCount ?? 0;
  const target = "≥ 4.5★, ≥ 1,000 ratings on storefront";

  const baseline = 0;
  const components: ScoreComponent[] = [];
  components.push({
    label: `Average rating: ${rating.toFixed(2)}★`,
    contribution:
      rating >= 4.7
        ? 8
        : rating >= 4.5
          ? 7
          : rating >= 4.2
            ? 6
            : rating >= 4.0
              ? 5
              : rating >= 3.5
                ? 3
                : 1,
    passed: rating >= 4.5,
    detail:
      rating === 0
        ? "No rating yet."
        : rating >= 4.7
          ? "Top 1% band."
          : rating >= 4.5
            ? "Strong."
            : rating >= 4.0
              ? "Above water."
              : "Below 4.0 — Apple ranking penalty zone.",
  });
  components.push({
    label: `Rating volume: ${count.toLocaleString()} ratings`,
    contribution: count >= 1_000_000 ? 2 : count >= 10_000 ? 1 : count >= 1_000 ? 0 : -2,
    passed: count >= 1_000,
    detail:
      count === 0
        ? "Zero ratings — listing has no social proof."
        : count < 100
          ? "Below 100 ratings — almost no statistical signal."
          : count < 1_000
            ? "Below 1k ratings — limited social proof."
            : count < 10_000
              ? "Healthy for a niche app."
              : count < 1_000_000
                ? "Strong volume."
                : "Top-tier volume.",
  });

  const score = applyComponents(baseline, components);

  const hint =
    score < 9
      ? joinHint([
          rating < 4.5 && "improve rating through in-app prompts and bug-fix release cadence",
          count < 1_000 && "trigger Apple's review prompt at moments of delight to grow volume",
        ])
      : null;

  return {
    score,
    baseline,
    components,
    observedValue: `${rating.toFixed(2)}★ (${count.toLocaleString()} ratings)`,
    target,
    source: "itunes",
    confidence: "deterministic",
    summary: `${rating.toFixed(2)}★ over ${count.toLocaleString()} ratings on the ${meta.storefront.toUpperCase()} storefront.`,
    improvementHint: hint,
    evidence: components.map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`),
  };
}

function scoreIcon(meta: AppMetadata): Computed {
  const present = !!meta.artworkUrl;
  if (!present) {
    return {
      score: 0,
      baseline: 0,
      components: [{ label: "No artwork URL", contribution: 0, passed: false }],
      observedValue: null,
      target: "Distinctive 1024×1024 icon, legible at 60×60",
      source: "itunes",
      confidence: "needs_visual_review",
      summary: "No icon URL returned by iTunes.",
      improvementHint: "Submit a 1024×1024 PNG icon via App Store Connect.",
      evidence: ["Artwork URL missing."],
    };
  }
  return {
    score: 6,
    baseline: 6,
    components: [
      {
        label: "Icon present",
        contribution: 0,
        passed: true,
        detail: meta.artworkUrl,
      },
    ],
    observedValue: meta.artworkUrl,
    target: "Distinctive at 60×60, no thin text, high category-fit",
    source: "itunes",
    confidence: "needs_visual_review",
    summary: "Icon present. Visual distinctiveness vs. category cannot be scored deterministically — held at 6/10 pending LLM/visual review.",
    improvementHint:
      "Ensure the icon is legible at 60×60, uses a saturated focal color, and is visually distinct from the top 3 category competitors.",
    evidence: [`Icon URL: ${meta.artworkUrl}`],
  };
}

function scoreConversionSignals(listing: ListingContent): Computed {
  const promo = (listing.promotionalText ?? "").trim();
  const releaseNotes = (listing.releaseNotes ?? "").trim();
  const baseline = 3;
  const components: ScoreComponent[] = [];

  if (promo) {
    components.push({
      label: `Promotional text present (${promo.length} chars)`,
      contribution: 3,
      passed: true,
      detail: truncate(promo, 160),
    });
  } else {
    components.push({
      label: "Promotional text missing",
      contribution: -1,
      passed: false,
      detail: "Promo text can be updated without an App Store review cycle — a free conversion lever.",
    });
  }

  if (releaseNotes) {
    components.push({
      label: `"What's New" present (${releaseNotes.length} chars)`,
      contribution: 3,
      passed: true,
      detail: truncate(releaseNotes, 160),
    });
  } else {
    components.push({
      label: '"What\'s New" missing',
      contribution: -1,
      passed: false,
      detail: "Apple highlights this in update notifications.",
    });
  }

  const score = applyComponents(baseline, components);

  const observedParts: string[] = [];
  if (promo) observedParts.push(`Promo: "${truncate(promo, 80)}"`);
  if (releaseNotes) observedParts.push(`What's New: "${truncate(releaseNotes, 80)}"`);

  return {
    score,
    baseline,
    components,
    observedValue: observedParts.length > 0 ? observedParts.join(" • ") : null,
    target: "Promo text + What's New, both updated within the last release cycle",
    source: listing.sources.longText === "none" ? null : listing.sources.longText,
    confidence: "deterministic",
    summary: `${promo ? "Promo text set" : "No promo text"} • ${releaseNotes ? "What's New set" : "No What's New"}.`,
    improvementHint:
      score < 9
        ? joinHint([
            !promo && "add promotional text with the current campaign hook",
            !releaseNotes && 'fill out "What\'s New" with user-facing changes, not just "Bug fixes"',
          ])
        : null,
    evidence: components.map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`),
  };
}

/**
 * Competitive Position — perfected, evidence-backed scoring.
 *
 * Compares the audited app to its peer set using:
 *   1. Rating percentile (mid-rank, robust to ties)
 *   2. Volume percentile (log-scaled — 1k vs 100M shouldn't be 100,000× weight)
 *   3. Peer-set quality (60% mean compositeScore + 40% chart-source share)
 *   4. Same-developer filter (a publisher's other apps are NOT real competition)
 *
 * Each signal is dampened by `confidenceDamp` so weak peer sets (few peers,
 * mostly term-search hits) can't dominate the score. Confidence flips to
 * "heuristic" unless we have ≥5 peers AND ≥0.5 peer-quality.
 */
function scoreCompetitivePosition(
  meta: AppMetadata,
  competitors: Competitor[],
): Computed {
  const baseline = 5;
  const TARGET_TEXT =
    "Top quartile rating AND top quartile volume vs. genre peers (verified by ≥5 high-quality peers)";

  // Step 1: filter same-developer apps out — they're not real competition.
  const selfDevKey = meta.artistName.trim().toLowerCase();
  const sameDevExcluded = competitors.filter(
    (c) => c.artistName.trim().toLowerCase() === selfDevKey,
  );
  const peers = competitors.filter(
    (c) => c.artistName.trim().toLowerCase() !== selfDevKey,
  );

  if (peers.length === 0) {
    const detail =
      sameDevExcluded.length > 0
        ? `Only ${sameDevExcluded.length} same-developer app(s) returned (${sameDevExcluded
            .map((c) => c.trackName)
            .slice(0, 3)
            .join(", ")}); excluded as non-competition.`
        : "Competitor scan returned no peers in this category.";
    return {
      score: 5,
      baseline,
      components: [
        {
          label: "No external competitors available",
          contribution: 0,
          passed: false,
          detail,
        },
      ],
      observedValue: null,
      target: TARGET_TEXT,
      source: null,
      confidence: "heuristic",
      summary:
        sameDevExcluded.length > 0
          ? `${sameDevExcluded.length} same-developer app(s) returned but no external peers; scored as neutral.`
          : "No external peers found in the same category; scored as neutral.",
      improvementHint: null,
      evidence: [detail],
    };
  }

  // Step 2: peer-set quality — how trustworthy is this comparison?
  const chartPeers = peers.filter(
    (p) => p.source === "top-free-chart" || p.source === "top-grossing-chart",
  );
  const chartFraction = chartPeers.length / peers.length;
  const compositeScores = peers
    .map((p) => p.compositeScore ?? p.overlapScore)
    .filter((n): n is number => typeof n === "number");
  const meanComposite = compositeScores.length
    ? compositeScores.reduce((a, b) => a + b, 0) / compositeScores.length
    : 0;
  // 60% real-similarity / 40% chart-source weight — chart presence is the
  // single strongest "this app actually competes in this category" signal.
  const peerQuality = clamp(0.6 * meanComposite + 0.4 * chartFraction, 0, 1);

  // Dampening factor — ranges 0.4..1.0
  //   - sampleSizeFactor reaches 1.0 at 10 peers
  //   - peerQuality multiplier ranges 0.5..1.0
  //   - floor at 0.4 so weak sets still register *some* signal
  const sampleSizeFactor = Math.min(1, peers.length / 10);
  const confidenceDamp = Math.max(
    0.4,
    sampleSizeFactor * (0.5 + 0.5 * peerQuality),
  );

  const components: ScoreComponent[] = [];

  // Step 3: rating percentile (±3 dampened)
  const myRating = meta.averageUserRating ?? 0;
  const ratedPeers = peers
    .map((p) => p.averageUserRating)
    .filter((r): r is number => typeof r === "number" && r > 0);
  let ratingPctText = "—";
  let ratingRankText = "—";
  let peerRatingMedian: number | null = null;

  if (myRating > 0 && ratedPeers.length >= 2) {
    const sample = [...ratedPeers, myRating];
    const pct = percentileOf(myRating, sample);
    ratingPctText = `${Math.round(pct * 100)}%`;
    // Rank position (1 = best). Use descending sort + last-tie position for fairness.
    const sortedDesc = [...sample].sort((a, b) => b - a);
    const rank = sortedDesc.findIndex((v) => v <= myRating) + 1;
    ratingRankText = `${rank}/${sample.length}`;
    peerRatingMedian = median(ratedPeers);
    const peerMean =
      ratedPeers.reduce((a, b) => a + b, 0) / ratedPeers.length;
    const contrib = (pct - 0.5) * 6 * confidenceDamp;
    components.push({
      label: `Rating percentile ${ratingPctText} (rank ${ratingRankText})`,
      contribution: Math.round(contrib * 10) / 10,
      passed: pct >= 0.5,
      detail: `${myRating.toFixed(2)}★ vs. peer median ${peerRatingMedian.toFixed(
        2,
      )}★ / mean ${peerMean.toFixed(2)}★ across ${ratedPeers.length} peers.`,
    });
  } else if (myRating === 0) {
    components.push({
      label: "No rating yet on listing",
      contribution: -1,
      passed: false,
      detail:
        "Listing has 0 ratings — cannot compute percentile; default penalty for unrated/launch state.",
    });
  } else {
    components.push({
      label: "Insufficient rated peers for rating percentile",
      contribution: 0,
      passed: false,
      detail: `Only ${ratedPeers.length} peer(s) with valid ratings — comparison skipped.`,
    });
  }

  // Step 4: volume percentile (±2.5 dampened, log-scaled)
  const myCount = meta.userRatingCount ?? 0;
  const countPeers = peers
    .map((p) => p.userRatingCount)
    .filter((n): n is number => typeof n === "number" && n > 0);
  let volumePctText = "—";
  let peerCountMedian: number | null = null;

  if (myCount > 0 && countPeers.length >= 2) {
    const logSample = [...countPeers, myCount].map(logCount);
    const pct = percentileOf(logCount(myCount), logSample);
    volumePctText = `${Math.round(pct * 100)}%`;
    peerCountMedian = median(countPeers);
    const contrib = (pct - 0.5) * 5 * confidenceDamp;
    components.push({
      label: `Rating volume percentile ${volumePctText} (log-scaled)`,
      contribution: Math.round(contrib * 10) / 10,
      passed: pct >= 0.5,
      detail: `${myCount.toLocaleString()} ratings vs. peer median ${peerCountMedian.toLocaleString()} — volume is Apple's strongest popularity signal.`,
    });
  } else if (myCount === 0) {
    components.push({
      label: "No rating volume on listing",
      contribution: -1,
      passed: false,
      detail:
        "0 logged ratings — typical of brand-new launches or apps not yet promoted.",
    });
  }

  // Step 5: peer-set quality bonus (0..+1, positive only — recognizes a strong
  // comparison set without penalizing the app for a weak scan)
  if (peerQuality > 0) {
    components.push({
      label: `Peer set quality ${Math.round(peerQuality * 100)}%`,
      contribution: Math.round(peerQuality * 10) / 10,
      passed: peerQuality >= 0.5,
      detail: `${chartPeers.length}/${peers.length} from Apple charts; mean similarity ${Math.round(
        meanComposite * 100,
      )}% across ${peers.length} peers (sample factor ${(sampleSizeFactor * 100).toFixed(0)}%, damp ${(confidenceDamp * 100).toFixed(0)}%).`,
    });
  }

  // Step 6: same-developer exclusion note — pure transparency, 0 contribution.
  if (sameDevExcluded.length > 0) {
    components.push({
      label: `Excluded ${sameDevExcluded.length} same-developer app(s) from peer set`,
      contribution: 0,
      passed: true,
      detail: sameDevExcluded
        .map((c) => c.trackName)
        .slice(0, 5)
        .join(", "),
    });
  }

  const score = applyComponents(baseline, components);

  const verdict =
    score >= 8.5
      ? "Category leader"
      : score >= 7.0
        ? "Top quartile"
        : score >= 5.5
          ? "Above peer median"
          : score >= 4.0
            ? "Near peer median"
            : score >= 2.5
              ? "Below peer median"
              : "Trailing peers significantly";

  // Dynamic confidence — only call it "deterministic" with a real sample.
  const confidence: NonNullable<DimensionScore["confidence"]> =
    peers.length >= 5 && peerQuality >= 0.5 ? "deterministic" : "heuristic";

  const observedParts: string[] = [];
  observedParts.push(`${myRating.toFixed(2)}★ / ${myCount.toLocaleString()} ratings`);
  if (ratingRankText !== "—") {
    observedParts.push(`rank ${ratingRankText}`);
  }
  observedParts.push(verdict);
  const observedValue = observedParts.join(" — ");

  const summary = `${verdict}. Rating percentile ${ratingPctText}, volume percentile ${volumePctText} across ${peers.length} ${
    peers.length === 1 ? "peer" : "peers"
  } (peer quality ${Math.round(peerQuality * 100)}%).`;

  const hint =
    score < 9
      ? joinHint([
          peerRatingMedian !== null &&
            myRating > 0 &&
            myRating < peerRatingMedian &&
            `raise rating above peer median (${peerRatingMedian.toFixed(
              2,
            )}★) via in-app review prompts at delight moments`,
          peerCountMedian !== null &&
            myCount > 0 &&
            myCount < peerCountMedian &&
            `grow rating volume — peer median is ${peerCountMedian.toLocaleString()} (you have ${myCount.toLocaleString()})`,
          myRating === 0 &&
            "ship in-app review prompts to start accumulating rating signal",
          myCount === 0 &&
            "drive first ratings through onboarding prompts and post-conversion moments",
          peerQuality < 0.5 &&
            "peer set is weak — strengthen listing keyword overlap with category leaders so the next scan returns true competitors",
          peers.length < 5 &&
            "competitor sample is small — broaden category/keyword targeting for a more reliable read",
        ])
      : null;

  return {
    score,
    baseline,
    components,
    observedValue,
    target: TARGET_TEXT,
    source: "itunes",
    confidence,
    summary,
    improvementHint: hint,
    evidence: components.map(
      (c) => `${c.label}${c.detail ? ` — ${c.detail}` : ""}`,
    ),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */

export function computeBaselineScores(input: {
  metadata: AppMetadata;
  listing: ListingContent;
  competitors: Competitor[];
}): DimensionScore[] {
  const { metadata, listing, competitors } = input;

  const wrap = (id: DimensionId, c: Computed): DimensionScore => ({
    id,
    score: c.score,
    weight: DIMENSION_WEIGHTS[id],
    weightedScore: weighted(id, c.score),
    summary: c.summary,
    evidence: c.evidence,
    baseline: c.baseline,
    components: c.components,
    observedValue: c.observedValue,
    target: c.target,
    source: c.source,
    confidence: c.confidence,
    improvementHint: c.improvementHint,
  });

  return [
    wrap("title", scoreTitle(listing)),
    wrap("subtitle", scoreSubtitle(listing, metadata)),
    wrap("keywordField", scoreKeywordField(listing)),
    wrap("description", scoreDescription(listing)),
    wrap("screenshots", scoreScreenshots(listing)),
    wrap("appPreviewVideo", scoreAppPreviewVideo(listing)),
    wrap("ratingsAndReviews", scoreRatingsAndReviews(metadata)),
    wrap("icon", scoreIcon(metadata)),
    wrap("conversionSignals", scoreConversionSignals(listing)),
    wrap("competitivePosition", scoreCompetitivePosition(metadata, competitors)),
  ];
}

export function aggregateOverallScore(scores: DimensionScore[]): number {
  const total = scores.reduce((acc, s) => acc + s.weightedScore, 0);
  return Math.round(clamp(total, 0, 100));
}
