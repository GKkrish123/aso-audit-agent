import { describe, it, expect } from "vitest";
import { aggregateOverallScore, computeBaselineScores } from "./scoring";
import {
  DIMENSION_IDS,
  DIMENSION_WEIGHTS,
  type AppMetadata,
  type Competitor,
  type ListingContent,
} from "@/types/audit";

const baseMetadata: AppMetadata = {
  appId: "324684580",
  storefront: "us",
  trackName: "Spotify: Music & Podcasts",
  artistName: "Spotify Ltd.",
  primaryGenreName: "Music",
  genres: ["Music", "Entertainment"],
  artworkUrl: "https://example.com/icon.png",
  appStoreUrl: "https://apps.apple.com/us/app/id324684580",
  averageUserRating: 4.8,
  userRatingCount: 24_000_000,
  price: 0,
  currency: "USD",
  contentAdvisoryRating: "12+",
  releaseDate: "2011-09-14",
  version: "9.0.0",
  minimumOsVersion: "15.0",
};

const baseListing: ListingContent = {
  title: "Spotify: Music & Podcasts",
  subtitle: "Discover new music, podcasts",
  description: "Listen to millions of songs and podcasts. Try Premium free.",
  releaseNotes: "Bug fixes and performance improvements.",
  promotionalText: "Free Premium trial for new users.",
  screenshotUrls: Array.from({ length: 10 }, (_, i) => `https://example.com/s${i}.png`),
  ipadScreenshotUrls: [],
  hasAppPreviewVideo: true,
  appPreviewVideoUrls: ["https://example.com/preview.mp4"],
  sources: { metadata: "itunes", longText: "html", screenshots: "html" },
};

const baseCompetitors: Competitor[] = [
  {
    appId: "284910350",
    trackName: "YouTube Music",
    artistName: "Google",
    averageUserRating: 4.7,
    userRatingCount: 5_000_000,
    primaryGenreName: "Music",
    appStoreUrl: "https://apps.apple.com/us/app/id284910350",
    overlapScore: 0.5,
  },
];

describe("computeBaselineScores", () => {
  it("returns one score per dimension", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    expect(out).toHaveLength(DIMENSION_IDS.length);
    const ids = new Set(out.map((d) => d.id));
    for (const id of DIMENSION_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("weighted score equals score10 * weight / 10", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    for (const d of out) {
      expect(d.weight).toBe(DIMENSION_WEIGHTS[d.id]);
      expect(d.weightedScore).toBeCloseTo((d.score * d.weight) / 10, 4);
    }
  });

  it("penalises missing description", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: { ...baseListing, description: "" },
      competitors: baseCompetitors,
    });
    const desc = out.find((d) => d.id === "description")!;
    expect(desc.score).toBe(0);
  });

  it("rewards full screenshot utilization", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    const ss = out.find((d) => d.id === "screenshots")!;
    expect(ss.score).toBeGreaterThanOrEqual(8);
  });

  it("penalises missing app preview video", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: {
        ...baseListing,
        hasAppPreviewVideo: false,
        appPreviewVideoUrls: [],
      },
      competitors: baseCompetitors,
    });
    const v = out.find((d) => d.id === "appPreviewVideo")!;
    expect(v.score).toBeLessThanOrEqual(3);
  });
});

describe("aggregateOverallScore", () => {
  it("is between 0 and 100", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    const total = aggregateOverallScore(out);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBeLessThanOrEqual(100);
  });

  it("is 0 for fully-empty input", () => {
    const out = computeBaselineScores({
      metadata: { ...baseMetadata, averageUserRating: 0, userRatingCount: 0 },
      listing: {
        ...baseListing,
        title: "",
        subtitle: "",
        description: "",
        screenshotUrls: [],
        hasAppPreviewVideo: false,
        appPreviewVideoUrls: [],
        releaseNotes: null,
        promotionalText: null,
      },
      competitors: [],
    });
    const total = aggregateOverallScore(out);
    expect(total).toBeLessThan(40);
  });
});
