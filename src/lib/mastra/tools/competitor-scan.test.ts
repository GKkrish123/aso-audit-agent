import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  genreIdFor,
  tokenize,
  runCompetitorScan,
  buildTargetRelevanceTokens,
  buildSearchTerms,
  relevanceScore,
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

const CHATGPT: AppMetadata = {
  appId: "6448311069",
  storefront: "us",
  trackName: "ChatGPT",
  artistName: "OpenAI",
  primaryGenreName: "Productivity",
  primaryGenreId: "6007",
  genreIds: ["6007"],
  genres: ["Productivity"],
  artworkUrl: "https://apps.apple.com/icon.png",
  appStoreUrl: "https://apps.apple.com/us/app/chatgpt/id6448311069",
  averageUserRating: 4.8,
  userRatingCount: 1_000_000,
  price: 0,
  currency: "USD",
  contentAdvisoryRating: "12+",
  releaseDate: "2023-05-18",
  version: "1.0",
  minimumOsVersion: "16.0",
  itunesDescription:
    "The official app by OpenAI. ChatGPT is your AI assistant for writing, learning, and chat.",
};

const CHATGPT_LISTING: ListingContent = {
  title: "ChatGPT",
  subtitle: "The official app by OpenAI",
  description:
    "Chat with the advanced AI assistant. Voice mode, image generation, and GPT-4o.",
  releaseNotes: null,
  promotionalText: "Your AI chat assistant",
  screenshotUrls: [],
  ipadScreenshotUrls: [],
  hasAppPreviewVideo: false,
  appPreviewVideoUrls: [],
  sources: { metadata: "itunes", longText: "firecrawl", screenshots: "none" },
};

describe("buildSearchTerms", () => {
  it("includes listing phrases and skips developer/genre noise", () => {
    const terms = buildSearchTerms(TARGET, LISTING);
    expect(terms[0]).toBe("Snapchat");
    expect(terms.some((t) => t.toLowerCase().includes("share"))).toBe(true);
    expect(terms).not.toContain("snap");
    expect(terms).not.toContain("photo");
    expect(terms).not.toContain("video");
  });

  it("derives terms from metadata when listing is missing", () => {
    const terms = buildSearchTerms(CHATGPT);
    expect(terms[0]).toBe("ChatGPT");
    expect(terms.some((t) => t.includes("OpenAI") || t.includes("assistant"))).toBe(
      true,
    );
  });
});

describe("relevance scoring", () => {
  it("scores Gmail/Drive low vs ChatGPT but Gemini higher", () => {
    const target = buildTargetRelevanceTokens(CHATGPT, CHATGPT_LISTING);
    const gmail = relevanceScore(target, {
      trackName: "Gmail – Email by Google",
      artistName: "Google",
      description: "Secure email from Google.",
    });
    const drive = relevanceScore(target, {
      trackName: "Google Drive",
      artistName: "Google",
      description: "Store photos and files in the cloud.",
    });
    const gemini = relevanceScore(target, {
      trackName: "Google Gemini",
      artistName: "Google",
      description:
        "Your AI assistant from Google. Chat, voice, and image generation.",
    });
    const claude = relevanceScore(target, {
      trackName: "Claude by Anthropic",
      artistName: "Anthropic",
      description: "AI assistant for chat, writing, and coding.",
    });
    expect(gmail).toBeLessThan(0.06);
    expect(drive).toBeLessThan(0.06);
    expect(gemini).toBeGreaterThan(0.06);
    expect(claude).toBeGreaterThan(0.06);
  });
});

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
                id: { attributes: { "im:id": "447188370" } },
                "im:name": { label: "Snapchat" },
                "im:artist": { label: "Snap, Inc." },
                category: {
                  attributes: { "im:id": "6008", label: "Photo & Video" },
                },
              },
              {
                id: { attributes: { "im:id": "1111" } },
                "im:name": { label: "Instagram" },
                "im:artist": { label: "Instagram, Inc." },
                category: {
                  attributes: { "im:id": "6005", label: "Social Networking" },
                },
              },
              {
                id: { attributes: { "im:id": "2222" } },
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
                id: { attributes: { "im:id": "3333" } },
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
              description:
                "Instagram lets you share the moment with photos and videos. Capture, edit, and share your moment with friends and family.",
            },
            {
              trackId: 2222,
              trackName: "Bitmoji",
              artistName: "Snap, Inc.",
              primaryGenreName: "Photo & Video",
              averageUserRating: 4.4,
              userRatingCount: 800_000,
              description:
                "Bitmoji is your personal avatar. Share the moment with custom emoji.",
            },
            {
              trackId: 3333,
              trackName: "TikTok",
              artistName: "ByteDance",
              primaryGenreName: "Entertainment",
              averageUserRating: 4.8,
              userRatingCount: 18_000_000,
              trackViewUrl: "https://apps.apple.com/us/app/tiktok/id3333",
              description:
                "TikTok: share the moment. Make and share short videos, fast.",
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
              description:
                "BeReal. Share the moment in a fast, authentic photo each day.",
            },
            {
              trackId: 5555,
              trackName: "TinyCam",
              artistName: "Indie Dev",
              primaryGenreName: "Photo & Video",
              averageUserRating: 4.0,
              userRatingCount: 8,
              trackViewUrl: "https://apps.apple.com/us/app/tinycam/id5555",
              description: "A tiny camera utility.",
            },
          ],
        },
      },
    });

    const result = await runCompetitorScan({ metadata: TARGET, listing: LISTING });

    const ids = result.competitors.map((c) => c.appId);
    expect(ids).not.toContain("447188370");
    expect(ids).not.toContain("2222");
    expect(ids).not.toContain("5555");
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

  it("filters low-relevance same-genre chart leaders via listing overlap", async () => {
    globalThis.fetch = makeFetchStub({
      "/rss/topfreeapplications": {
        jsonValue: {
          feed: {
            entry: [
              {
                id: { attributes: { "im:id": "6448311069" } },
                "im:name": { label: "ChatGPT" },
                "im:artist": { label: "OpenAI" },
                category: { attributes: { "im:id": "6007", label: "Productivity" } },
              },
              {
                id: { attributes: { "im:id": "1001" } },
                "im:name": { label: "Gmail – Email by Google" },
                "im:artist": { label: "Google" },
                category: { attributes: { "im:id": "6007", label: "Productivity" } },
              },
              {
                id: { attributes: { "im:id": "1002" } },
                "im:name": { label: "Google Drive" },
                "im:artist": { label: "Google" },
                category: { attributes: { "im:id": "6007", label: "Productivity" } },
              },
              {
                id: { attributes: { "im:id": "1003" } },
                "im:name": { label: "Google Gemini" },
                "im:artist": { label: "Google" },
                category: { attributes: { "im:id": "6007", label: "Productivity" } },
              },
            ],
          },
        },
      },
      "/rss/topgrossingapplications": {
        jsonValue: { feed: { entry: [] } },
      },
      "/lookup?id=": {
        jsonValue: {
          results: [
            {
              trackId: 1001,
              trackName: "Gmail – Email by Google",
              artistName: "Google",
              primaryGenreName: "Productivity",
              description: "Secure email from Google.",
              averageUserRating: 4.72,
              userRatingCount: 2_410_220,
            },
            {
              trackId: 1002,
              trackName: "Google Drive",
              artistName: "Google",
              primaryGenreName: "Productivity",
              description: "Cloud storage for files and photos.",
              averageUserRating: 4.78,
              userRatingCount: 7_557_043,
            },
            {
              trackId: 1003,
              trackName: "Google Gemini",
              artistName: "Google",
              primaryGenreName: "Productivity",
              description:
                "AI assistant with chat, voice, and image generation like ChatGPT.",
              averageUserRating: 4.72,
              userRatingCount: 1_739_805,
            },
            {
              trackId: 2001,
              trackName: "Claude by Anthropic",
              artistName: "Anthropic",
              primaryGenreName: "Productivity",
              description: "AI chat assistant for writing and coding.",
              averageUserRating: 4.8,
              userRatingCount: 500_000,
            },
          ],
        },
      },
      "/search?": {
        jsonValue: {
          results: [
            {
              trackId: 2001,
              trackName: "Claude by Anthropic",
              artistName: "Anthropic",
              primaryGenreName: "Productivity",
              description: "AI chat assistant for writing and coding.",
              averageUserRating: 4.8,
              userRatingCount: 500_000,
            },
            {
              trackId: 2002,
              trackName: "Perplexity - AI Search",
              artistName: "Perplexity AI",
              primaryGenreName: "Productivity",
              description: "AI search and chat answers with sources.",
              averageUserRating: 4.7,
              userRatingCount: 300_000,
            },
          ],
        },
      },
    });

    const result = await runCompetitorScan({
      metadata: CHATGPT,
      listing: CHATGPT_LISTING,
    });

    const names = result.competitors.map((c) => c.trackName);
    expect(names).not.toContain("Gmail – Email by Google");
    expect(names).not.toContain("Google Drive");
    expect(names.some((n) => /claude|gemini|perplexity/i.test(n))).toBe(true);
    for (const c of result.competitors) {
      expect(c.overlapScore).toBeGreaterThanOrEqual(0.06);
    }
  });

  it("excludes video editors for streaming apps (YouTube)", async () => {
    const YOUTUBE: AppMetadata = {
      ...TARGET,
      appId: "544007664",
      trackName: "YouTube",
      artistName: "Google",
      primaryGenreName: "Photo & Video",
      primaryGenreId: "6008",
      genres: ["Photo & Video"],
      itunesDescription:
        "Watch and subscribe to channels. Stream videos, music, and Shorts.",
    };
    const YOUTUBE_LISTING: ListingContent = {
      title: "YouTube",
      subtitle: "Videos, Music and Live Streams",
      description:
        "Watch videos, stream music, discover Shorts, and subscribe to creators.",
      releaseNotes: null,
      promotionalText: null,
      screenshotUrls: [],
      ipadScreenshotUrls: [],
      hasAppPreviewVideo: false,
      appPreviewVideoUrls: [],
      sources: { metadata: "itunes", longText: "firecrawl", screenshots: "none" },
    };

    globalThis.fetch = makeFetchStub({
      "/rss/topfreeapplications": {
        jsonValue: {
          feed: {
            entry: [
              {
                id: { attributes: { "im:id": "544007664" } },
                "im:name": { label: "YouTube" },
                "im:artist": { label: "Google" },
                category: { attributes: { "im:id": "6008", label: "Photo & Video" } },
              },
              {
                id: { attributes: { "im:id": "8001" } },
                "im:name": { label: "Splice - Video Editor & Maker" },
                "im:artist": { label: "Bending Spoons" },
                category: { attributes: { "im:id": "6008", label: "Photo & Video" } },
              },
              {
                id: { attributes: { "im:id": "8002" } },
                "im:name": { label: "TikTok" },
                "im:artist": { label: "ByteDance" },
                category: { attributes: { "im:id": "6016", label: "Entertainment" } },
              },
            ],
          },
        },
      },
      "/rss/topgrossingapplications": { jsonValue: { feed: { entry: [] } } },
      "/lookup?id=": {
        jsonValue: {
          results: [
            {
              trackId: 8001,
              trackName: "Splice - Video Editor & Maker",
              artistName: "Bending Spoons",
              primaryGenreName: "Photo & Video",
              description: "Edit videos like a pro with our video editor.",
              averageUserRating: 4.6,
              userRatingCount: 200_000,
            },
            {
              trackId: 8002,
              trackName: "TikTok",
              artistName: "ByteDance",
              primaryGenreName: "Entertainment",
              description: "Watch and create short videos. Stream trending content.",
              averageUserRating: 4.8,
              userRatingCount: 20_000_000,
            },
          ],
        },
      },
      "/search?": { jsonValue: { results: [] } },
    });

    const result = await runCompetitorScan({
      metadata: YOUTUBE,
      listing: YOUTUBE_LISTING,
    });

    const names = result.competitors.map((c) => c.trackName);
    expect(names.some((n) => /splice/i.test(n))).toBe(false);
    expect(names.some((n) => /tiktok/i.test(n))).toBe(true);
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
                  "im:name": { label: "Instagram" },
                  "im:artist": { label: "Instagram, Inc." },
                  category: {
                    attributes: { "im:id": "6008", label: "Photo & Video" },
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
                trackName: "Instagram",
                artistName: "Instagram, Inc.",
                primaryGenreName: "Photo & Video",
                genres: ["Photo & Video", "Social Networking"],
                description:
                  "Share photos and videos with friends. A fast fun way to share the moment.",
                averageUserRating: 4.7,
                userRatingCount: 24_000_000,
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
