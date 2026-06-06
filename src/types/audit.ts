import { z } from "zod";

export const AppMetadataSchema = z.object({
  appId: z.string(),
  storefront: z.string(),
  trackName: z.string(),
  artistName: z.string(),
  bundleId: z.string().optional(),
  primaryGenreName: z.string().optional(),
  /** Numeric iTunes genre id, e.g. "6008" for Photo & Video. Used by the
   *  competitor scanner to drive genre-filtered iTunes Search + RSS top-charts. */
  primaryGenreId: z.string().optional(),
  /** Full chain of iTunes genre ids (most-specific first), e.g. ["6014","7001"]. */
  genreIds: z.array(z.string()).optional(),
  genres: z.array(z.string()),
  artworkUrl: z.string().url(),
  appStoreUrl: z.string().url(),
  averageUserRating: z.number().nullable(),
  userRatingCount: z.number().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  contentAdvisoryRating: z.string().nullable(),
  releaseDate: z.string().nullable(),
  version: z.string().nullable(),
  minimumOsVersion: z.string().nullable(),
  // iTunes Lookup baseline so listing scrape degradation never leaves empty copy/screenshots.
  itunesDescription: z.string().nullable().optional(),
  itunesReleaseNotes: z.string().nullable().optional(),
  itunesScreenshotUrls: z.array(z.string().url()).optional(),
  itunesIpadScreenshotUrls: z.array(z.string().url()).optional(),
});
export type AppMetadata = z.infer<typeof AppMetadataSchema>;

export const ListingContentSchema = z.object({
  title: z.string(),
  subtitle: z.string().nullable(),
  description: z.string(),
  releaseNotes: z.string().nullable(),
  promotionalText: z.string().nullable(),
  screenshotUrls: z.array(z.string().url()).default([]),
  ipadScreenshotUrls: z.array(z.string().url()).default([]),
  hasAppPreviewVideo: z.boolean(),
  appPreviewVideoUrls: z.array(z.string().url()).default([]),
  appPreviewVideoPosters: z.array(z.string()).default([]).optional(),
  sources: z.object({
    metadata: z.enum(["itunes", "html", "firecrawl", "unknown"]),
    longText: z.enum(["itunes", "html", "firecrawl", "none"]),
    screenshots: z.enum(["itunes", "html", "firecrawl", "none"]),
  }),
});
export type ListingContent = z.infer<typeof ListingContentSchema>;

export const CompetitorSchema = z.object({
  appId: z.string(),
  trackName: z.string(),
  artistName: z.string(),
  averageUserRating: z.number().nullable(),
  userRatingCount: z.number().nullable(),
  primaryGenreName: z.string().optional(),
  appStoreUrl: z.string().url(),
  overlapScore: z.number().min(0).max(1),
  /** Blend of source signal, genre match, token overlap, popularity, rating. */
  compositeScore: z.number().min(0).max(1).optional(),
  /** top-chart is the strongest "actual competitor in this category" signal. */
  source: z
    .enum([
      "top-free-chart",
      "top-grossing-chart",
      "genre-search",
      "subgenre-search",
      "term-search",
    ])
    .optional(),
  chartRank: z.number().int().positive().optional(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const DIMENSION_IDS = [
  "title",
  "subtitle",
  "keywordField",
  "description",
  "screenshots",
  "appPreviewVideo",
  "ratingsAndReviews",
  "icon",
  "conversionSignals",
  "competitivePosition",
] as const;
export type DimensionId = (typeof DIMENSION_IDS)[number];

export const DIMENSION_WEIGHTS: Record<DimensionId, number> = {
  title: 20,
  subtitle: 15,
  keywordField: 15,
  description: 10,
  screenshots: 15,
  appPreviewVideo: 5,
  ratingsAndReviews: 15,
  icon: 5,
  conversionSignals: 5,
  competitivePosition: 5,
};

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  title: "Title",
  subtitle: "Subtitle",
  keywordField: "Keyword Field",
  description: "Description",
  screenshots: "Screenshots",
  appPreviewVideo: "App Preview Video",
  ratingsAndReviews: "Ratings & Reviews",
  icon: "Icon",
  conversionSignals: "Conversion Signals",
  competitivePosition: "Competitive Position",
};

export const ScoreComponentSchema = z.object({
  label: z.string(),
  contribution: z.number(),
  passed: z.boolean(),
  detail: z.string().optional(),
});
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

export const SCORE_CONFIDENCE = [
  "deterministic",
  "heuristic",
  "needs_visual_review",
] as const;

export const SCORE_SOURCE = [
  "itunes",
  "firecrawl",
  "html",
  "merged",
  "computed",
] as const;

export const DimensionScoreSchema = z.object({
  id: z.enum(DIMENSION_IDS),
  score: z.number().min(0).max(10),
  weight: z.number().min(0).max(100),
  weightedScore: z.number().min(0).max(100),
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
  baseline: z.number().min(0).max(10).optional(),
  components: z.array(ScoreComponentSchema).default([]).optional(),
  observedValue: z.string().nullable().optional(),
  target: z.string().nullable().optional(),
  source: z.enum(SCORE_SOURCE).nullable().optional(),
  confidence: z.enum(SCORE_CONFIDENCE).optional(),
  improvementHint: z.string().nullable().optional(),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

export const RECOMMENDATION_CATEGORIES = [
  "copy",
  "design",
  "media",
  "engineering",
  "marketing",
  "strategy",
] as const;
export type RecommendationCategory =
  (typeof RECOMMENDATION_CATEGORIES)[number];

export const EFFORT_UNITS = ["minutes", "hours", "days", "sprints"] as const;
export type EffortUnit = (typeof EFFORT_UNITS)[number];

/**
 * One actionable recommendation with a full proof trail. Every field after
 * `after` is treated as optional at the schema layer because LLMs vary, but
 * the workflow post-processor (`enrichRecommendation`) guarantees ALL
 * recommendations in the final report have these fields populated -
 * deriving deterministic defaults from the dimension's baseline score and
 * severity bucket when the LLM omits them. The UI can therefore render the
 * proof block unconditionally.
 *
 *   - `category`: what kind of work this is (copy/design/media/engineering/...)
 *   - `metric`:   the concrete current-vs-target gap being closed
 *   - `expectedImpact`: signed score-delta projection per affected dimension
 *   - `effort`:   concrete time estimate (minutes / hours / days / sprints)
 *   - `location`: where in App Store Connect (or off-platform) to apply
 *   - `before` / `after`: required for any text/copy change
 */
export const RecommendationSchema = z.object({
  id: z.string().min(1),
  dimension: z.enum(DIMENSION_IDS),
  severity: z.enum(["quickWin", "highImpact", "strategic"]),
  category: z.enum(RECOMMENDATION_CATEGORIES).optional(),
  title: z.string().min(3),
  rationale: z.string().min(10),
  evidence: z.string().min(3),
  before: z.string().nullable(),
  after: z.string().nullable(),
  metric: z
    .object({
      current: z.string().min(1),
      target: z.string().min(1),
    })
    .nullable()
    .optional(),
  expectedImpact: z
    .array(
      z.object({
        dimensionId: z.enum(DIMENSION_IDS),
        expectedDelta: z.number().min(-10).max(10),
        note: z.string().optional(),
      }),
    )
    .default([])
    .optional(),
  effort: z
    .object({
      unit: z.enum(EFFORT_UNITS),
      estimate: z.number().positive(),
    })
    .nullable()
    .optional(),
  location: z.string().nullable().optional(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * One competitor's evidence-backed comparison vs. the audited app. Every field
 * is derived deterministically from the iTunes payload + scanner metadata - no
 * LLM-generated numbers - so the rendered table is guaranteed accurate.
 *
 *   - `ratingDelta`  = audited.rating - competitor.rating         (signed; null if either missing)
 *   - `ratingCountRatio` = audited.ratingCount / competitor.ratingCount  (null if competitor.ratingCount <= 0)
 *   - `strengths`    = things THIS competitor does better than the audited app
 *   - `weaknesses`   = things the audited app does better than this competitor
 */
export const CompetitorComparisonRowSchema = z.object({
  competitorAppId: z.string().min(1),
  competitorName: z.string().min(1),
  developerName: z.string().min(1),
  category: z.string().nullable(),
  appStoreUrl: z.string().url(),

  rating: z.number().nullable(),
  ratingCount: z.number().nullable(),

  ratingDelta: z.number().nullable(),
  ratingCountRatio: z.number().nullable(),

  keywordOverlap: z.number().min(0).max(1),
  compositeSimilarity: z.number().min(0).max(1).nullable(),

  source: z
    .enum([
      "top-free-chart",
      "top-grossing-chart",
      "genre-search",
      "subgenre-search",
      "term-search",
    ])
    .nullable(),
  chartRank: z.number().int().positive().nullable(),

  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),

  notes: z.string().default(""),
});
export type CompetitorComparisonRow = z.infer<
  typeof CompetitorComparisonRowSchema
>;

export const AuditReportSchema = z.object({
  overallScore: z.number().min(0).max(100),
  dimensionScores: z.array(DimensionScoreSchema),
  recommendations: z.array(RecommendationSchema),
  competitorComparison: z.array(CompetitorComparisonRowSchema),
  warnings: z.array(z.string()).default([]),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

export const AUDIT_JOB_STATUSES = [
  "queued",
  "fetching_metadata",
  "awaiting_confirmation",
  "running_audit",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AuditJobStatus = (typeof AUDIT_JOB_STATUSES)[number];

export const AuditMediaSchema = z.object({
  iconUrl: z.string().url().nullable(),
  iphoneScreenshots: z.array(z.string().url()).default([]),
  ipadScreenshots: z.array(z.string().url()).default([]),
  appPreviewVideos: z
    .array(
      z.object({
        url: z.string().url(),
        posterUrl: z.string().url().nullable().optional(),
      }),
    )
    .default([]),
});
export type AuditMedia = z.infer<typeof AuditMediaSchema>;

export const AuditJobSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  status: z.enum(AUDIT_JOB_STATUSES),
  inputUrl: z.string(),
  parsed: z
    .object({
      appId: z.string(),
      storefront: z.string(),
      canonicalUrl: z.string(),
    })
    .nullable(),
  metadata: AppMetadataSchema.nullable(),
  report: AuditReportSchema.nullable(),
  media: AuditMediaSchema.nullable(),
  warnings: z.array(z.string()).default([]),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AuditJob = z.infer<typeof AuditJobSchema>;
