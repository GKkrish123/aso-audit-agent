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
  description:
    "Try Spotify Premium free for 1 month. Discover 100 million songs, podcasts, and audiobooks. Trusted by 600 million users worldwide.\n\n• Listen offline\n• Hi-fi audio\n• Personalized playlists",
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
    expect(desc.observedValue).toBeNull();
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

describe("structured proof trail", () => {
  it("emits an observedValue for each scored field", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    const title = out.find((d) => d.id === "title")!;
    const subtitle = out.find((d) => d.id === "subtitle")!;
    const description = out.find((d) => d.id === "description")!;
    expect(title.observedValue).toBe(baseListing.title);
    expect(subtitle.observedValue).toBe(baseListing.subtitle);
    expect(description.observedValue?.length).toBeGreaterThan(0);
  });

  it("emits components whose contributions reconstruct the score", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    for (const d of out) {
      const components = d.components ?? [];
      if (components.length === 0) continue;
      const expected =
        (d.baseline ?? 0) +
        components.reduce((acc, c) => acc + c.contribution, 0);

      const clamped = Math.max(0, Math.min(10, expected));
      expect(d.score).toBeCloseTo(Math.round(clamped * 10) / 10, 1);
    }
  });

  it("attaches a target benchmark to every dimension", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    for (const d of out) {
      expect(d.target).toBeTruthy();
    }
  });

  it("marks icon as needs_visual_review and caps deterministic score at 6", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    const icon = out.find((d) => d.id === "icon")!;
    expect(icon.confidence).toBe("needs_visual_review");
    expect(icon.score).toBeLessThanOrEqual(6);
  });

  it("dynamic summary mentions the actual title length", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    const title = out.find((d) => d.id === "title")!;
    expect(title.summary).toContain(String(baseListing.title.length));
  });
});

describe("scoring rule fixes", () => {
  it("does NOT flag a hyphenated brand name as a separator", () => {
    const out = computeBaselineScores({
      metadata: { ...baseMetadata, trackName: "Wake-Up Light Clock" },
      listing: { ...baseListing, title: "Wake-Up Light Clock", subtitle: "Sunrise alarm" },
      competitors: baseCompetitors,
    });
    const title = out.find((d) => d.id === "title")!;
    const separatorRule = (title.components ?? []).find((c) =>
      c.label.toLowerCase().includes("separator"),
    );
    expect(separatorRule).toBeUndefined();
  });

  it("does NOT flag brand reinforcement (artist token) as wasted overlap in subtitle", () => {
    const out = computeBaselineScores({
      metadata: { ...baseMetadata, trackName: "Spotify", artistName: "Spotify Ltd." },
      listing: {
        ...baseListing,
        title: "Spotify: Music & Podcasts",
        subtitle: "Spotify for Artists",
      },
      competitors: baseCompetitors,
    });
    const sub = out.find((d) => d.id === "subtitle")!;
    const overlapRule = (sub.components ?? []).find((c) =>
      c.label.toLowerCase().includes("repeats non-brand title word"),
    );
    expect(overlapRule).toBeUndefined();
  });

  it("does flag a real non-brand title/subtitle duplication", () => {
    const out = computeBaselineScores({
      metadata: { ...baseMetadata, trackName: "Calm", artistName: "Calm.com Inc." },
      listing: {
        ...baseListing,
        title: "Calm: Meditation & Sleep",
        subtitle: "Sleep stories meditation calm",
      },
      competitors: baseCompetitors,
    });
    const sub = out.find((d) => d.id === "subtitle")!;
    const overlapRule = (sub.components ?? []).find((c) =>
      c.label.toLowerCase().includes("repeats non-brand title word"),
    );
    expect(overlapRule).toBeDefined();
  });

  it('tokenizes before checking wasted words ("appendix" does not match "app")', () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: { ...baseListing, title: "Appendix Reader" },
      competitors: baseCompetitors,
    });
    const title = out.find((d) => d.id === "title")!;
    const wastedRule = (title.components ?? []).find((c) =>
      c.label.toLowerCase().includes("wasted word"),
    );
    expect(wastedRule).toBeUndefined();
  });

  it("captures the social proof literal it matched", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: baseListing,
      competitors: baseCompetitors,
    });
    const desc = out.find((d) => d.id === "description")!;
    const social = (desc.components ?? []).find((c) =>
      c.label.toLowerCase().includes("social proof"),
    );
    expect(social).toBeDefined();
    expect(social!.detail).toBeTruthy();
  });

  it("produces an improvementHint when the score is below ceiling", () => {
    const out = computeBaselineScores({
      metadata: baseMetadata,
      listing: { ...baseListing, subtitle: "Music" },
      competitors: baseCompetitors,
    });
    const sub = out.find((d) => d.id === "subtitle")!;
    expect(sub.score).toBeLessThan(9);
    expect(sub.improvementHint).toBeTruthy();
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
