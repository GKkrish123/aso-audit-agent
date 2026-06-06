import { createTool } from "@mastra/core/tools";
import pRetry from "p-retry";
import pLimit from "p-limit";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/observability/logger";
import { getMetrics } from "@/lib/observability/metrics";
import {
  AppMetadataSchema,
  CompetitorSchema,
  type AppMetadata,
  type Competitor,
  type ListingContent,
} from "@/types/audit";

const ITUNES_SEARCH = "https://itunes.apple.com/search";
const ITUNES_LOOKUP = "https://itunes.apple.com/lookup";
const ITUNES_RSS = (
  country: string,
  kind: "topfree" | "topgrossing",
  genreId: string | undefined,
  limit: number,
) =>
  `https://itunes.apple.com/${encodeURIComponent(country)}/rss/${kind === "topfree" ? "topfreeapplications" : "topgrossingapplications"}/limit=${limit}${genreId ? `/genre=${encodeURIComponent(genreId)}` : ""}/json`;

const MIN_RATING_COUNT = 50;
/**
 * Drop chart/search hits with insufficient lexical overlap to the target listing.
 * Raised from 0.06 → 0.10 alongside the smarter relevance scorer (headline
 * recall + body Jaccard). The lower bound now reliably filters Roblox/CoC
 * out of a Call-of-Duty audit (their relevance < 0.05) while still admitting
 * true substitutes (PUBG, Free Fire, Standoff — all > 0.30).
 */
const MIN_RELEVANCE_SCORE = 0.1;
const SEARCH_LIMIT = 50;
const TOP_CHART_LIMIT = 50;
const MAX_SEARCH_TERMS = 8;
const SEARCH_CONCURRENCY = 5;

// Fallback when iTunes Lookup didn't return primaryGenreId (legacy records).
const GENRE_NAME_TO_ID: Record<string, string> = {
  Books: "6018",
  Business: "6000",
  Catalogs: "6022",
  "Developer Tools": "6026",
  Education: "6017",
  Entertainment: "6016",
  Finance: "6015",
  "Food & Drink": "6023",
  Games: "6014",
  "Graphics & Design": "6027",
  "Health & Fitness": "6013",
  Lifestyle: "6012",
  "Magazines & Newspapers": "6021",
  Medical: "6020",
  Music: "6011",
  Navigation: "6010",
  News: "6009",
  "Photo & Video": "6008",
  Productivity: "6007",
  Reference: "6006",
  Shopping: "6024",
  "Social Networking": "6005",
  Sports: "6004",
  Stickers: "6025",
  Travel: "6003",
  Utilities: "6002",
  Weather: "6001",
};

export function genreIdFor(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return GENRE_NAME_TO_ID[name];
}

const STOPWORDS = new Set([
  // Function words
  "a","about","above","after","again","against","all","am","an","and","any",
  "app","apps","application","applications","are","aren","as","at","be","because",
  "been","before","being","below","best","between","both","but","by","can","cannot",
  "could","did","do","does","doing","don","down","during","each","easy","every",
  "few","for","free","from","further","get","got","had","has","have","having","he",
  "her","here","hers","herself","him","himself","his","how","i","if","in","into",
  "is","isn","it","its","itself","just","like","me","more","most","my","myself",
  "new","no","nor","not","now","of","off","official","on","once","one","only","or",
  "other","ought","our","ours","ourselves","out","over","own","plus","pro","s",
  "same","she","should","shouldn","so","some","such","t","than","that","the",
  "their","theirs","them","themselves","then","there","these","they","this","those",
  "through","to","too","under","until","up","use","using","very","was","wasn","we",
  "were","what","when","where","which","while","who","whom","why","will","with",
  "won","would","you","your","yours","yourself","yourselves",
  "play","players","world","worlds","fun","way","ways","amazing","awesome",
  "ultimate","epic","huge","incredible","today","day","days","year","years",
  "welcome","ready","enjoy","join","millions","anyone","loved","real","truly",
  "endless","unlimited","powerful","beautiful","favorite","favourite","perfect",
  "made","makes","let","lets","gets","getting","want","wants","need","needs",
  "inc","llc","ltd","corp","corporation","co","gmbh","sa","ag","srl","plc","sas",
]);

export function tokenize(s: string | undefined | null): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .split(/[\W_]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface SearchResult {
  trackId?: number;
  trackName?: string;
  artistId?: number;
  artistName?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  primaryGenreName?: string;
  primaryGenreId?: number;
  genres?: string[];
  genreIds?: string[];
  trackViewUrl?: string;
  description?: string;
}

async function abortableJson<T>(
  url: string,
  timeoutMs: number,
): Promise<T | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`${url.split("?")[0]} HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function searchITunes(opts: {
  term: string;
  country: string;
  genreId?: string;
  timeoutMs: number;
  limit?: number;
}): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    term: opts.term,
    country: opts.country,
    entity: "software",
    limit: String(opts.limit ?? SEARCH_LIMIT),
  });
  if (opts.genreId) params.set("genreId", opts.genreId);
  const url = `${ITUNES_SEARCH}?${params.toString()}`;
  const json = await abortableJson<{ results?: SearchResult[] }>(
    url,
    opts.timeoutMs,
  );
  return json?.results ?? [];
}

interface RssEntry {
  id?: { attributes?: { "im:id"?: string } };
  "im:name"?: { label?: string };
  "im:artist"?: { label?: string };
  category?: { attributes?: { "im:id"?: string; label?: string } };
}

async function fetchTopChart(opts: {
  country: string;
  genreId?: string;
  kind: "topfree" | "topgrossing";
  timeoutMs: number;
  limit?: number;
}): Promise<Array<{ appId: string; chartRank: number; trackName?: string; artistName?: string; primaryGenreName?: string }>> {
  const url = ITUNES_RSS(opts.country, opts.kind, opts.genreId, opts.limit ?? TOP_CHART_LIMIT);
  const json = await abortableJson<{ feed?: { entry?: RssEntry[] } }>(
    url,
    opts.timeoutMs,
  );
  const entries = json?.feed?.entry ?? [];
  return entries
    .map((e, i) => ({
      appId: e.id?.attributes?.["im:id"] ?? "",
      chartRank: i + 1,
      trackName: e["im:name"]?.label,
      artistName: e["im:artist"]?.label,
      primaryGenreName: e.category?.attributes?.label,
    }))
    .filter((c) => c.appId);
}

async function batchLookup(opts: {
  ids: string[];
  country: string;
  timeoutMs: number;
}): Promise<SearchResult[]> {
  if (opts.ids.length === 0) return [];
  const CHUNK = 150;
  const chunks: string[][] = [];
  for (let i = 0; i < opts.ids.length; i += CHUNK) {
    chunks.push(opts.ids.slice(i, i + CHUNK));
  }
  const limit = pLimit(2);
  const all = await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const url = `${ITUNES_LOOKUP}?id=${chunk.join(",")}&country=${encodeURIComponent(opts.country)}&entity=software`;
        const json = await abortableJson<{ results?: SearchResult[] }>(
          url,
          opts.timeoutMs,
        );
        return json?.results ?? [];
      }),
    ),
  );
  return all.flat();
}

type CandidateSource =
  | "top-free-chart"
  | "top-grossing-chart"
  | "genre-search"
  | "subgenre-search"
  | "term-search";

interface CandidateMeta {
  source: CandidateSource;
  chartRank?: number;
}

const SOURCE_WEIGHT: Record<CandidateSource, number> = {
  "top-free-chart": 1.0,
  "top-grossing-chart": 0.85,
  "genre-search": 0.7,
  "subgenre-search": 0.6,
  "term-search": 0.45,
};

export interface CompetitorScanResult {
  competitors: Competitor[];
  fallbackReason: string | null;
}

function genreMatchScore(
  target: AppMetadata,
  candidate: SearchResult,
): number {
  if (!target.primaryGenreName || !candidate.primaryGenreName) return 0.5;

  const primaryMatch =
    candidate.primaryGenreName === target.primaryGenreName ? 1 : 0;

  const targetSub = new Set(
    (target.genres ?? []).filter((g) => g !== target.primaryGenreName),
  );
  const candidateSub = new Set(
    (candidate.genres ?? []).filter((g) => g !== candidate.primaryGenreName),
  );

  let subgenreRecall: number;
  if (targetSub.size === 0 || candidateSub.size === 0) {
    // Unknown sub-genres — neither penalize nor reward (legacy iTunes records).
    subgenreRecall = 0.5;
  } else {
    let inter = 0;
    for (const g of targetSub) if (candidateSub.has(g)) inter++;
    subgenreRecall = inter / targetSub.size;
  }

  return 0.35 * primaryMatch + 0.65 * subgenreRecall;
}

function popularityScore(
  ratingCount: number | undefined,
  maxRatingCount: number,
): number {
  if (!ratingCount || ratingCount <= 0) return 0;
  if (maxRatingCount <= 1) return 0;
  return Math.min(
    1,
    Math.log10(ratingCount + 1) / Math.log10(maxRatingCount + 1),
  );
}

/**
 * The "relevance profile" of a listing — separates the curated, intentional
 * keywords (title + subtitle + promotional text) from the broader body
 * vocabulary (description). This split is critical because:
 *
 *   - Headline tokens are *high-signal* — they're the operator's deliberate
 *     keyword choices for App Store search. A candidate that contains them
 *     in any field is almost certainly targeting the same user intent.
 *   - Body tokens are *medium-signal* — every popular app's description has
 *     hundreds of words, mostly noise. Comparing them with a symmetric Jaccard
 *     is appropriate for "shared use-case" detection but not strong enough
 *     to be the only signal.
 *
 * Combining the two with a directional recall on headline + symmetric Jaccard
 * on body is what stops Roblox/Clash-of-Clans from being scored as Call of
 * Duty competitors: their headlines share NONE of CoD's distinctive tokens
 * (shooter, battle, royale, warfare), and their bodies overlap only on
 * generic marketing fluff which is already filtered by STOPWORDS.
 */
export interface RelevanceProfile {
  /** Title + subtitle + promotional text tokens — the most discriminating signals. */
  headline: Set<string>;
  /** Description tokens (first ~1500 chars) — used for symmetric overlap. */
  body: Set<string>;
}

/**
 * Build the relevance profile for the audited app. Excludes `artistName` from
 * both sets — developer-name matches are noise (we already filter
 * same-developer candidates), and including them risks matching other apps
 * that simply mention the developer.
 */
export function buildTargetRelevanceTokens(
  metadata: AppMetadata,
  listing?: ListingContent,
): RelevanceProfile {
  const headline = new Set<string>();
  const body = new Set<string>();
  const addTo = (target: Set<string>, s: string | undefined | null): void => {
    for (const t of tokenize(s ?? "")) target.add(t);
  };

  addTo(headline, metadata.trackName);
  if (listing) {
    addTo(headline, listing.subtitle);
    addTo(headline, listing.promotionalText);
  }

  const longText =
    listing?.description?.trim() || metadata.itunesDescription?.trim() || "";
  addTo(body, longText.slice(0, 1500));

  return { headline, body };
}

/** Build the equivalent profile for a search-result candidate. */
function candidateProfile(candidate: SearchResult): RelevanceProfile {
  const headline = new Set<string>();
  const body = new Set<string>();
  for (const t of tokenize(candidate.trackName)) headline.add(t);
  for (const t of tokenize(candidate.description?.slice(0, 1500))) body.add(t);
  return { headline, body };
}

/** |a ∩ b| — used for both recall and Jaccard. */
function intersectionSize(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter;
}

/**
 * Relevance score in [0, 1], computed as:
 *
 *   relevance = 0.55 · headlineRecall + 0.45 · bodyJaccard
 *
 * Where:
 *   - `headlineRecall` is the fraction of TARGET headline tokens (the
 *     intentional keywords) that appear ANYWHERE in the candidate's listing
 *     (its title OR its description body). This is a directional measure of
 *     "does the candidate target the same user intent as us?"
 *   - `bodyJaccard` is the symmetric Jaccard overlap of the two description
 *     bodies — a "do these apps describe what they do in similar terms?" signal.
 *
 * The 55/45 weighting matters: a candidate that mentions our distinctive
 * keywords ("shooter", "royale") in its title/description is a far stronger
 * peer signal than one that merely shares generic marketing vocabulary in
 * its body. This is what flips Call of Duty's competitor set from
 * Roblox+Clash-of-Clans to Free Fire+PUBG+Standoff.
 */
export function relevanceScore(
  target: RelevanceProfile,
  candidate: SearchResult,
): number {
  const cand = candidateProfile(candidate);
  const candAll = new Set<string>([...cand.headline, ...cand.body]);

  let headlineRecall = 0;
  if (target.headline.size > 0) {
    const hits = intersectionSize(target.headline, candAll);
    headlineRecall = hits / target.headline.size;
  }

  const bodyJaccard = jaccard(target.body, cand.body);

  const combined = 0.55 * headlineRecall + 0.45 * bodyJaccard;
  return Math.max(0, Math.min(1, combined));
}

/**
 * iTunes search terms from the listing: short phrases first, then distinctive tokens.
 * No category-specific hardcoding — works for music, games, productivity, etc.
 */
export function buildSearchTerms(
  metadata: AppMetadata,
  listing?: ListingContent,
  maxTerms = MAX_SEARCH_TERMS,
): string[] {
  const developerTokens = tokenize(metadata.artistName);
  const genreTokens = new Set<string>([
    ...tokenize(metadata.primaryGenreName ?? ""),
    ...(metadata.genres ?? []).flatMap((g) => [...tokenize(g)]),
  ]);
  const drop = new Set([...developerTokens, ...genreTokens]);

  const terms: string[] = [];
  const seen = new Set<string>();

  const addPhrase = (raw: string | undefined | null): void => {
    const phrase = raw?.trim();
    if (!phrase || phrase.length < 3) return;
    const key = phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(phrase);
  };

  const addTokens = (s: string | undefined | null): void => {
    for (const t of tokenize(s ?? "")) {
      if (drop.has(t) || seen.has(t)) continue;
      seen.add(t);
      terms.push(t);
    }
  };

  if (metadata.trackName.trim()) addPhrase(metadata.trackName);
  if (listing?.subtitle?.trim()) addPhrase(listing.subtitle);
  if (listing?.promotionalText?.trim()) addPhrase(listing.promotionalText);

  const desc =
    listing?.description?.trim() || metadata.itunesDescription?.trim() || "";
  if (desc) {
    const firstBlock = desc.split(/\n{2,}/)[0]?.trim() ?? "";
    if (firstBlock.length > 0 && firstBlock.length <= 120) addPhrase(firstBlock);
  }

  addTokens(metadata.trackName);
  if (listing) {
    addTokens(listing.subtitle);
    addTokens(listing.promotionalText);
    addTokens((listing.description ?? "").slice(0, 600));
  }
  addTokens(metadata.itunesDescription?.slice(0, 600));

  return terms.slice(0, maxTerms);
}

export async function runCompetitorScan(input: {
  metadata: AppMetadata;
  listing?: ListingContent;
}): Promise<CompetitorScanResult> {
  const env = getEnv();
  const logger = getLogger();
  const metrics = getMetrics();
  const metadata = input.metadata;
  const relevanceTokens = buildTargetRelevanceTokens(metadata, input.listing);
  // If we don't have enough target signal to score relevance reliably (no
  // listing passed AND no itunesDescription on metadata), skip relevance
  // gating and rely on genre + popularity. This protects the tool-only call
  // path (LLM invokes competitor-scan without a full workflow context).
  const enforceRelevance =
    relevanceTokens.headline.size + relevanceTokens.body.size >= 3;
  if (!enforceRelevance) {
    logger.warn(
      {
        appId: metadata.appId,
        headlineSize: relevanceTokens.headline.size,
        bodySize: relevanceTokens.body.size,
      },
      "Competitor scan: target relevance profile is too thin; skipping relevance gate (fallback to genre + popularity ranking).",
    );
  }

  const primaryGenreId =
    metadata.primaryGenreId ?? genreIdFor(metadata.primaryGenreName);
  const subGenreId = metadata.genreIds?.find((id) => id !== primaryGenreId);
  const searchTerms = buildSearchTerms(metadata, input.listing);

  const tryCountries = Array.from(
    new Set([metadata.storefront.toLowerCase(), "us"]),
  );

  async function gatherFor(country: string): Promise<{
    candidates: Map<string, CandidateMeta>;
    enriched: Map<string, SearchResult>;
  }> {
    const limit = pLimit(SEARCH_CONCURRENCY);
    const candidates = new Map<string, CandidateMeta>();
    const enriched = new Map<string, SearchResult>();

    const upgrade = (appId: string, meta: CandidateMeta): void => {
      const existing = candidates.get(appId);
      if (!existing) {
        candidates.set(appId, meta);
        return;
      }
      const existingW = SOURCE_WEIGHT[existing.source];
      const newW = SOURCE_WEIGHT[meta.source];
      if (newW > existingW) {
        candidates.set(appId, meta);
      } else if (
        newW === existingW &&
        meta.chartRank !== undefined &&
        (existing.chartRank === undefined || meta.chartRank < existing.chartRank)
      ) {
        candidates.set(appId, meta);
      }
    };

    const tasks: Array<Promise<void>> = [];

    for (const kind of ["topfree", "topgrossing"] as const) {
      tasks.push(
        limit(async () => {
          try {
            const top = await pRetry(
              () =>
                fetchTopChart({
                  country,
                  genreId: primaryGenreId,
                  kind,
                  timeoutMs: env.METADATA_TIMEOUT_MS,
                }),
              { retries: 1, minTimeout: 250, maxTimeout: 750 },
            );
            metrics.increment(`competitor.rss.${kind}.success`);
            for (const c of top) {
              upgrade(c.appId, {
                source:
                  kind === "topfree" ? "top-free-chart" : "top-grossing-chart",
                chartRank: c.chartRank,
              });
            }
          } catch (err) {
            metrics.increment(`competitor.rss.${kind}.error`);
            logger.warn(
              { country, kind, err: (err as Error).message },
              "iTunes RSS top chart failed",
            );
          }
        }),
      );
    }

    if (metadata.primaryGenreName || primaryGenreId) {
      const term = metadata.primaryGenreName ?? metadata.trackName;
      tasks.push(
        limit(async () => {
          try {
            const results = await pRetry(
              () =>
                searchITunes({
                  term,
                  country,
                  genreId: primaryGenreId,
                  timeoutMs: env.METADATA_TIMEOUT_MS,
                }),
              { retries: 1, minTimeout: 250, maxTimeout: 750 },
            );
            for (const r of results) {
              if (!r.trackId) continue;
              const appId = String(r.trackId);
              enriched.set(appId, r);
              upgrade(appId, { source: "genre-search" });
            }
          } catch (err) {
            logger.warn(
              { term, country, err: (err as Error).message },
              "iTunes genre search failed",
            );
          }
        }),
      );
    }

    if (subGenreId && metadata.genres && metadata.genres.length > 1) {
      const subTerm = metadata.genres[1] ?? metadata.primaryGenreName ?? "";
      if (subTerm) {
        tasks.push(
          limit(async () => {
            try {
              const results = await pRetry(
                () =>
                  searchITunes({
                    term: subTerm,
                    country,
                    genreId: subGenreId,
                    timeoutMs: env.METADATA_TIMEOUT_MS,
                  }),
                { retries: 1, minTimeout: 250, maxTimeout: 750 },
              );
              for (const r of results) {
                if (!r.trackId) continue;
                const appId = String(r.trackId);
                enriched.set(appId, r);
                upgrade(appId, { source: "subgenre-search" });
              }
            } catch (err) {
              logger.warn(
                { term: subTerm, country, err: (err as Error).message },
                "iTunes subgenre search failed",
              );
            }
          }),
        );
      }
    }

    const runTermSearch = (term: string): void => {
      tasks.push(
        limit(async () => {
          try {
            const results = await pRetry(
              () =>
                searchITunes({
                  term,
                  country,
                  genreId: primaryGenreId,
                  timeoutMs: env.METADATA_TIMEOUT_MS,
                }),
              { retries: 1, minTimeout: 250, maxTimeout: 750 },
            );
            for (const r of results) {
              if (!r.trackId) continue;
              const appId = String(r.trackId);
              enriched.set(appId, r);
              upgrade(appId, { source: "term-search" });
            }
          } catch (err) {
            logger.warn(
              { term, country, err: (err as Error).message },
              "iTunes term search failed",
            );
          }
        }),
      );
    };

    for (const term of searchTerms) runTermSearch(term);

    await Promise.all(tasks);

    // RSS doesn't return rating counts; enrich chart-only candidates via Lookup.
    const needsEnrichment: string[] = [];
    for (const appId of candidates.keys()) {
      if (!enriched.has(appId)) needsEnrichment.push(appId);
    }
    if (needsEnrichment.length > 0) {
      try {
        const looked = await batchLookup({
          ids: needsEnrichment,
          country,
          timeoutMs: env.METADATA_TIMEOUT_MS,
        });
        for (const r of looked) {
          if (!r.trackId) continue;
          enriched.set(String(r.trackId), r);
        }
      } catch (err) {
        logger.warn(
          { country, err: (err as Error).message },
          "Batch lookup for chart competitors failed",
        );
      }
    }

    return { candidates, enriched };
  }

  let candidates: Map<string, CandidateMeta> = new Map();
  let enriched: Map<string, SearchResult> = new Map();
  let resolvedCountry = tryCountries[0]!;
  for (const country of tryCountries) {
    const r = await gatherFor(country);
    if (r.candidates.size > 0) {
      candidates = r.candidates;
      enriched = r.enriched;
      resolvedCountry = country;
      break;
    }
  }

  const skippedReasons: Record<string, number> = {};
  const accepted: Array<{
    appId: string;
    meta: CandidateMeta;
    full: SearchResult;
    relevance: number;
  }> = [];
  for (const [appId, meta] of candidates) {
    if (appId === metadata.appId) {
      skippedReasons.targetSelf = (skippedReasons.targetSelf ?? 0) + 1;
      continue;
    }
    const full = enriched.get(appId);
    if (!full) {
      skippedReasons.unenriched = (skippedReasons.unenriched ?? 0) + 1;
      continue;
    }
    if ((full.userRatingCount ?? 0) < MIN_RATING_COUNT) {
      skippedReasons.lowRatings = (skippedReasons.lowRatings ?? 0) + 1;
      continue;
    }
    if (
      typeof full.artistId === "number" &&
      typeof (metadata as { artistId?: number }).artistId === "number" &&
      full.artistId === (metadata as { artistId?: number }).artistId
    ) {
      skippedReasons.sameDeveloper = (skippedReasons.sameDeveloper ?? 0) + 1;
      continue;
    }
    if (
      full.artistName &&
      metadata.artistName &&
      full.artistName.trim().toLowerCase() === metadata.artistName.trim().toLowerCase()
    ) {
      skippedReasons.sameDeveloper = (skippedReasons.sameDeveloper ?? 0) + 1;
      continue;
    }
    const relevance = relevanceScore(relevanceTokens, full);
    // Relevance gate is only enforced when we have a meaningful basis for
    // comparison on BOTH sides. When `enforceRelevance` is false (tool-only
    // calls without listing, or candidates returned by iTunes without
    // descriptions), we fall back to genre + popularity ranking. Avoids the
    // degenerate "everything filtered" failure mode while still preferring
    // listing-similarity when the data permits.
    if (enforceRelevance && relevance < MIN_RELEVANCE_SCORE) {
      skippedReasons.lowRelevance = (skippedReasons.lowRelevance ?? 0) + 1;
      continue;
    }
    accepted.push({ appId, meta, full, relevance });
  }

  if (accepted.length > 0) {
    logger.info(
      {
        country: resolvedCountry,
        pool: candidates.size,
        accepted: accepted.length,
        skipped: skippedReasons,
      },
      "Competitor pool gathered",
    );
  }

  const maxRatingCount =
    accepted.reduce((m, c) => Math.max(m, c.full.userRatingCount ?? 0), 0) || 1;

  /**
   * Composite ranking weights (must sum to 1.0). Retuned to fix the
   * "Call of Duty audit returns Roblox + Clash of Clans" failure mode:
   *
   *   relevance:    0.50  (↑ from 0.38)  Listing-similarity dominates so
   *                                       generic top-chart leaders in the
   *                                       same genre but unrelated use case
   *                                       can't sneak past direct substitutes.
   *   genreMatch:   0.18  (↑ from 0.12)  Now meaningful because the scorer
   *                                       uses sub-genre recall, not just
   *                                       primary-genre equality.
   *   popularity:   0.12  (↓ from 0.20)  Reduced so absolute size doesn't
   *                                       dominate intent fit.
   *   sourceWeight: 0.08  (↓ from 0.12)
   *   ratingQuality:0.08  (↓ from 0.10)
   *   chartSignal:  0.04  (↓ from 0.08)
   *                       ──────
   *   total:        1.00
   */
  const W_RELEVANCE = 0.50;
  const W_GENRE = 0.18;
  const W_POP = 0.12;
  const W_SOURCE = 0.08;
  const W_RATING_Q = 0.08;
  const W_CHART = 0.04;

  const ranked: Array<
    Competitor & { _composite: number; _breakdown: Record<string, number> }
  > = accepted.map(({ appId, meta, full, relevance }) => {
    const sourceW = SOURCE_WEIGHT[meta.source];
    const chartSignal =
      meta.chartRank !== undefined
        ? Math.max(0, (TOP_CHART_LIMIT + 1 - meta.chartRank) / TOP_CHART_LIMIT)
        : 0;
    const genreM = genreMatchScore(metadata, full);
    const pop = popularityScore(full.userRatingCount, maxRatingCount);
    const ratingQ = (full.averageUserRating ?? 0) / 5;
    const composite =
      W_RELEVANCE * relevance +
      W_GENRE * genreM +
      W_POP * pop +
      W_SOURCE * sourceW +
      W_RATING_Q * ratingQ +
      W_CHART * chartSignal;
    const competitor: Competitor = {
      appId,
      trackName: full.trackName ?? "(unknown)",
      artistName: full.artistName ?? "(unknown)",
      averageUserRating: full.averageUserRating ?? null,
      userRatingCount: full.userRatingCount ?? null,
      primaryGenreName: full.primaryGenreName,
      appStoreUrl:
        full.trackViewUrl ??
        `https://apps.apple.com/${resolvedCountry}/app/id${appId}`,
      overlapScore: Number(relevance.toFixed(4)),
      compositeScore: Number(composite.toFixed(4)),
      source: meta.source,
      ...(meta.chartRank !== undefined ? { chartRank: meta.chartRank } : {}),
    };
    return {
      ...competitor,
      _composite: composite,
      _breakdown: {
        relevance: Number(relevance.toFixed(3)),
        genreM: Number(genreM.toFixed(3)),
        pop: Number(pop.toFixed(3)),
        sourceW: Number(sourceW.toFixed(3)),
        ratingQ: Number(ratingQ.toFixed(3)),
        chartSignal: Number(chartSignal.toFixed(3)),
      },
    };
  });

  ranked.sort((a, b) => {
    if (b._composite !== a._composite) return b._composite - a._composite;
    const aCount = a.userRatingCount ?? 0;
    const bCount = b.userRatingCount ?? 0;
    if (bCount !== aCount) return bCount - aCount;
    return a.appId.localeCompare(b.appId);
  });

  // Surface the top-5 composite breakdown to logs so production failures
  // ("why did X get picked over Y?") are diagnosable without a re-run.
  if (ranked.length > 0) {
    logger.info(
      {
        appId: metadata.appId,
        targetName: metadata.trackName,
        country: resolvedCountry,
        topCandidates: ranked.slice(0, 5).map((r) => ({
          name: r.trackName,
          composite: Number(r._composite.toFixed(4)),
          ...r._breakdown,
          source: r.source,
          chartRank: r.chartRank,
        })),
      },
      "Competitor composite ranking (top 5)",
    );
  }

  const top3 = ranked
    .slice(0, 3)
    .map(({ _composite, _breakdown, ...c }) => {
      void _composite;
      void _breakdown;
      return c;
    });

  const fallbackReason =
    top3.length === 0
      ? "No competitor candidates returned from iTunes search or top-charts."
      : top3.length < 3
        ? `Only ${top3.length} competitor candidate${top3.length === 1 ? "" : "s"} passed quality filters.`
        : null;

  metrics.increment("competitor.scan.success", {
    count: String(top3.length),
    country: resolvedCountry,
  });

  return { competitors: top3, fallbackReason };
}

export const competitorScanTool = createTool({
  id: "competitor-scan",
  description:
    "Selects the top 3 competitor apps for an App Store listing. Aggregates candidates from iTunes RSS top-free + top-grossing charts (genre-filtered), iTunes Search by genre/sub-genre, and phrase/token search derived from the app's listing copy. Filters out the target, same-developer apps, low-rating listings (<50 ratings), and candidates with low lexical overlap to the listing (generic chart leaders in the same category but different use case). Ranks by listing relevance first, then genre match, popularity, and chart signal.",
  // Only `metadata` is exposed to the LLM tool surface. The workflow's
  // pure-function call site additionally passes `listing` to enrich query
  // tokens (see runCompetitorScan signature). Mirroring the full ListingContent
  // schema here would force tool callers to construct a richer payload than
  // they need, and Zod's `.default([])` on screenshot arrays interacts poorly
  // with `.optional()` in nested objects.
  inputSchema: z.object({
    metadata: AppMetadataSchema,
  }),
  outputSchema: z.object({
    competitors: z.array(CompetitorSchema),
    fallbackReason: z.string().nullable(),
  }),
  execute: async (inputData) => runCompetitorScan(inputData),
});
