import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  genreIdFor,
  tokenize,
  runCompetitorScan,
} from "./competitor-scan.tool";
import type { AppMetadata, ListingContent } from "@/types/audit";

const TARGET: AppMetadata = {
  appId: "447188370",
  storefront: "us",
  trackName: "Snapchat",
  artistName: "Snap, Inc.",
  primaryGenreName: "Photo & Video",
  primaryGenreId: "6008",
  genreIds: ["6008", "6005"],
  genres: ["Photo & Video", "Social Networking"],
  artworkUrl: "https://apps.apple.com/icon.png",
  appStoreUrl: "https://apps.apple.com/us/app/snapchat/id447188370",
  averageUserRating: 4.5,
  userRatingCount: 5_800_000,
  price: 0,
  currency: "USD",
  contentAdvisoryRating: "12+",
  releaseDate: "2011-07-13",
  version: "13.10.0",
  minimumOsVersion: "13.0",
};

const LISTING: ListingContent = {
  title: "Snapchat",
  subtitle: "Share the moment!",
  description: "Snapchat is a fast and fun way to share the moment...",
  releaseNotes: null,
  promotionalText: "Snapchat is a fast and fun way to share the moment",
  screenshotUrls: [],
  ipadScreenshotUrls: [],
  hasAppPreviewVideo: false,
  appPreviewVideoUrls: [],
  sources: { metadata: "itunes", longText: "firecrawl", screenshots: "none" },
};

describe("genreIdFor", () => {
  it("maps top-level App Store category names to their numeric ids", () => {
    expect(genreIdFor("Photo & Video")).toBe("6008");
    expect(genreIdFor("Social Networking")).toBe("6005");
    expect(genreIdFor("Games")).toBe("6014");
    expect(genreIdFor("Productivity")).toBe("6007");
  });

  it("returns undefined for unknown / empty names", () => {
    expect(genreIdFor(undefined)).toBeUndefined();
    expect(genreIdFor("Nonexistent Genre")).toBeUndefined();
  });
});

describe("tokenize", () => {
  it("lowercases, splits on non-word chars, and drops stop-words", () => {
    expect([...tokenize("The Best Free Photo App for Everyone")]).toEqual([
      "photo",
      "everyone",
    ]);
  });

  it("drops the literal word 'app' / 'apps'", () => {
    expect([...tokenize("Notes App")]).toEqual(["notes"]);
    expect([...tokenize("Best apps for productivity")]).toEqual([
      "productivity",
    ]);
  });

  it("keeps multi-word distinctive tokens", () => {
    const out = [...tokenize("Headspace: Meditation & Sleep")];
    expect(out).toContain("headspace");
    expect(out).toContain("meditation");
    expect(out).toContain("sleep");
  });

  it("returns empty for null/empty input", () => {
    expect(tokenize(null).size).toBe(0);
    expect(tokenize(undefined).size).toBe(0);
    expect(tokenize("").size).toBe(0);
  });
});

interface StubResponse {
  jsonValue: unknown;
  status?: number;
}

function makeFetchStub(
  routes: Record<string, StubResponse>,
): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = url instanceof URL ? url.toString() : String(url);
    for (const [pattern, resp] of Object.entries(routes)) {
      if (u.includes(pattern)) {
        return new Response(JSON.stringify(resp.jsonValue), {
          status: resp.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

describe("runCompetitorScan", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.PRIMARY_MODEL = process.env.PRIMARY_MODEL ?? "openai/gpt-5.1";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("picks competitors from top-chart + genre search, excluding target and same-developer", async () => {
    globalThis.fetch = makeFetchStub({
      "/rss/topfreeapplications": {
        jsonValue: {
          feed: {
            entry: [
              {
                id: { attributes: { "im:id": "447188370" } }, // target itself
                "im:name": { label: "Snapchat" },
                "im:artist": { label: "Snap, Inc." },
                category: {
                  attributes: { "im:id": "6008", label: "Photo & Video" },
                },
              },
              {
                id: { attributes: { "im:id": "1111" } }, // good competitor
                "im:name": { label: "Instagram" },
                "im:artist": { label: "Instagram, Inc." },
                category: {
                  attributes: { "im:id": "6005", label: "Social Networking" },
                },
              },
              {
                id: { attributes: { "im:id": "2222" } }, // same developer - drop
                "im:name": { label: "Bitmoji" },
                "im:artist": { label: "Snap, Inc." },
                category: {
                  attributes: { "im:id": "6008", label: "Photo & Video" },
                },
              },
            ],
          },
        },
      },
      "/rss/topgrossingapplications": {
        jsonValue: {
          feed: {
            entry: [
              {
                id: { attributes: { "im:id": "3333" } }, // top-grossing peer
                "im:name": { label: "TikTok" },
                "im:artist": { label: "ByteDance" },
                category: {
                  attributes: { "im:id": "6016", label: "Entertainment" },
                },
              },
            ],
          },
        },
      },
      "/lookup?id=": {
        jsonValue: {
          results: [
            {
              trackId: 1111,
              trackName: "Instagram",
              artistName: "Instagram, Inc.",
              primaryGenreName: "Photo & Video",
              primaryGenreId: 6008,
              genres: ["Photo & Video", "Social Networking"],
              averageUserRating: 4.7,
              userRatingCount: 24_000_000,
              trackViewUrl: "https://apps.apple.com/us/app/instagram/id1111",
            },
            {
              trackId: 2222,
              trackName: "Bitmoji",
              artistName: "Snap, Inc.",
              primaryGenreName: "Photo & Video",
              averageUserRating: 4.4,
              userRatingCount: 800_000,
            },
            {
              trackId: 3333,
              trackName: "TikTok",
              artistName: "ByteDance",
              primaryGenreName: "Entertainment",
              averageUserRating: 4.8,
              userRatingCount: 18_000_000,
              trackViewUrl: "https://apps.apple.com/us/app/tiktok/id3333",
            },
          ],
        },
      },
      "/search?": {
        jsonValue: {
          results: [
            {
              trackId: 4444,
              trackName: "BeReal",
              artistName: "BeReal",
              primaryGenreName: "Photo & Video",
              averageUserRating: 4.3,
              userRatingCount: 250_000,
              trackViewUrl: "https://apps.apple.com/us/app/bereal/id4444",
            },
            {
              trackId: 5555, // low ratings - should be filtered
              trackName: "TinyCam",
              artistName: "Indie Dev",
              primaryGenreName: "Photo & Video",
              averageUserRating: 4.0,
              userRatingCount: 8,
              trackViewUrl: "https://apps.apple.com/us/app/tinycam/id5555",
            },
          ],
        },
      },
    });

    const result = await runCompetitorScan({ metadata: TARGET, listing: LISTING });

    const ids = result.competitors.map((c) => c.appId);
    expect(ids).not.toContain("447188370"); // target excluded
    expect(ids).not.toContain("2222"); // same developer excluded
    expect(ids).not.toContain("5555"); // <50 ratings excluded
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(3);

    for (const c of result.competitors) {
      expect(c.compositeScore).toBeGreaterThanOrEqual(0);
      expect(c.compositeScore).toBeLessThanOrEqual(1);
      expect(c.source).toBeDefined();
    }
  });

  it("returns fallbackReason when no competitors pass filters", async () => {
    globalThis.fetch = makeFetchStub({
      "/rss/topfreeapplications": { jsonValue: { feed: { entry: [] } } },
      "/rss/topgrossingapplications": { jsonValue: { feed: { entry: [] } } },
      "/search?": { jsonValue: { results: [] } },
      "/lookup?id=": { jsonValue: { results: [] } },
    });

    const result = await runCompetitorScan({ metadata: TARGET });
    expect(result.competitors).toEqual([]);
    expect(result.fallbackReason).toMatch(/no competitor/i);
  });

  it("falls back to the US storefront when target storefront is empty", async () => {
    const calls: string[] = [];
    globalThis.fetch = ((url: RequestInfo | URL) => {
      const u = url instanceof URL ? url.toString() : String(url);
      calls.push(u);
      if (u.includes("/jp/")) {
        return new Response(JSON.stringify({ feed: { entry: [] } }), {
          status: 200,
        });
      }
      if (u.includes("/us/") && u.includes("/rss/topfreeapplications")) {
        return new Response(
          JSON.stringify({
            feed: {
              entry: [
                {
                  id: { attributes: { "im:id": "6666" } },
                  "im:name": { label: "Line" },
                  "im:artist": { label: "LY Corp." },
                  category: {
                    attributes: { "im:id": "6005", label: "Social Networking" },
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (u.includes("/lookup?id=")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                trackId: 6666,
                trackName: "Line",
                artistName: "LY Corp.",
                primaryGenreName: "Social Networking",
                averageUserRating: 4.2,
                userRatingCount: 200_000,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runCompetitorScan({
      metadata: { ...TARGET, storefront: "jp" },
    });

    expect(calls.some((c) => c.includes("/jp/"))).toBe(true);
    expect(calls.some((c) => c.includes("/us/"))).toBe(true);
    expect(result.competitors.length).toBeGreaterThan(0);
  });
});
