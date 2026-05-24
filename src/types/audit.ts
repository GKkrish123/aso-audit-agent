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

export const DimensionScoreSchema = z.object({
  id: z.enum(DIMENSION_IDS),
  score: z.number().min(0).max(10),
  weight: z.number().min(0).max(100),
  weightedScore: z.number().min(0).max(100),
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

export const RecommendationSchema = z.object({
  id: z.string().min(1),
  dimension: z.enum(DIMENSION_IDS),
  severity: z.enum(["quickWin", "highImpact", "strategic"]),
  title: z.string().min(3),
  rationale: z.string().min(10),
  evidence: z.string().min(3),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const CompetitorComparisonRowSchema = z.object({
  competitorAppId: z.string().min(1),
  competitorName: z.string().min(1),
  rating: z.number().nullable(),
  ratingCount: z.number().nullable(),
  keywordOverlap: z.number().min(0).max(1),
  notes: z.string().min(3),
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
  warnings: z.array(z.string()).default([]),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AuditJob = z.infer<typeof AuditJobSchema>;
