import { describe, expect, it } from "vitest";
import {
  fallbackCompetitorSearchIntent,
  intentAlignmentScore,
  isExcludedCompetitor,
  buildSearchTermsWithIntent,
  titleMatchesCompetitorName,
  namedCompetitorRank,
  sortCompetitorsByRelevance,
} from "@/lib/aso/competitor-search-intent";
import { buildSearchTerms } from "@/lib/mastra/tools/competitor-scan.tool";
import type { AppMetadata } from "@/types/audit";

const YOUTUBE: AppMetadata = {
  appId: "544007664",
  storefront: "us",
  trackName: "YouTube",
  artistName: "Google",
  primaryGenreName: "Photo & Video",
  primaryGenreId: "6008",
  genreIds: ["6008"],
  genres: ["Photo & Video"],
  artworkUrl: "https://apps.apple.com/icon.png",
  appStoreUrl: "https://apps.apple.com/us/app/youtube/id544007664",
  averageUserRating: 4.7,
  userRatingCount: 50_000_000,
  price: 0,
  currency: "USD",
  contentAdvisoryRating: "12+",
  releaseDate: "2012-09-11",
  version: "1.0",
  minimumOsVersion: "16.0",
  itunesDescription:
    "Watch and subscribe to channels. Stream videos, music, and Shorts from creators worldwide.",
};

describe("fallbackCompetitorSearchIntent", () => {
  it("targets streaming substitutes for YouTube, not video editors", () => {
    const intent = fallbackCompetitorSearchIntent(YOUTUBE);
    expect(intent.productCategory.toLowerCase()).toContain("stream");
    expect(intent.searchTerms.some((t) => /stream|watch|short/i.test(t))).toBe(
      true,
    );
    expect(intent.excludeTerms.some((t) => /editor|editing|maker/i.test(t))).toBe(
      true,
    );
  });

  it("builds search terms with heuristic phrases first", () => {
    const intent = fallbackCompetitorSearchIntent(YOUTUBE);
    const base = buildSearchTerms(YOUTUBE);
    const merged = buildSearchTermsWithIntent(YOUTUBE, undefined, intent, base, 8);
    expect(merged[0]).toMatch(/stream|watch|video/i);
    expect(merged.length).toBeGreaterThan(0);
  });
});

describe("isExcludedCompetitor", () => {
  it("excludes video editors when intent targets streaming", () => {
    const intent = fallbackCompetitorSearchIntent(YOUTUBE);
    expect(
      isExcludedCompetitor(intent, {
        trackName: "Splice - Video Editor & Maker",
        description: "Professional mobile video editor.",
      }),
    ).toBe(true);
    expect(
      isExcludedCompetitor(intent, {
        trackName: "TikTok",
        description: "Watch and create short videos.",
      }),
    ).toBe(false);
  });
});

describe("intentAlignmentScore", () => {
  it("scores TikTok highest among streaming rivals for YouTube", () => {
    const intent = fallbackCompetitorSearchIntent(YOUTUBE);
    const tiktok = intentAlignmentScore(intent, {
      trackName: "TikTok",
      description: "Watch and create short videos.",
    });
    const netflix = intentAlignmentScore(intent, {
      trackName: "Netflix",
      description: "Stream movies and TV shows.",
    });
    expect(tiktok).toBeGreaterThan(0.9);
    expect(tiktok).toBeGreaterThan(netflix);
  });

  it("matches competitor names in titles", () => {
    expect(titleMatchesCompetitorName("TikTok - Videos, Shop & LIVE", "TikTok")).toBe(
      true,
    );
    expect(namedCompetitorRank(fallbackCompetitorSearchIntent(YOUTUBE), "TikTok")).toBe(
      0,
    );
  });
});

describe("sortCompetitorsByRelevance", () => {
  it("prefers named rivals on composite ties", () => {
    const intent = fallbackCompetitorSearchIntent(YOUTUBE);
    const rows = sortCompetitorsByRelevance([
      {
        appId: "2",
        trackName: "Netflix",
        userRatingCount: 1_000_000,
        _composite: 0.7,
        _namedRank: namedCompetitorRank(intent, "Netflix"),
        _breakdown: { intentAlign: 0.7, relevance: 0.2 },
      },
      {
        appId: "1",
        trackName: "TikTok",
        userRatingCount: 500_000,
        _composite: 0.7,
        _namedRank: namedCompetitorRank(intent, "TikTok"),
        _breakdown: { intentAlign: 0.95, relevance: 0.3 },
      },
    ]);
    expect(rows[0]?.trackName).toBe("TikTok");
  });
});
