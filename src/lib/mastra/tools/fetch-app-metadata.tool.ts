import { createTool } from "@mastra/core/tools";
import pRetry from "p-retry";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/observability/logger";
import { getMetrics } from "@/lib/observability/metrics";
import { AppMetadataSchema, type AppMetadata } from "@/types/audit";

const ITUNES_LOOKUP = "https://itunes.apple.com/lookup";

interface ITunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  bundleId?: string;
  primaryGenreName?: string;
  primaryGenreId?: number;
  genres?: string[];
  /** Same order as `genres`. */
  genreIds?: string[];
  artworkUrl512?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  price?: number;
  currency?: string;
  contentAdvisoryRating?: string;
  releaseDate?: string;
  version?: string;
  minimumOsVersion?: string;
  // Listing-ish fields the iTunes Lookup endpoint also returns. We pass these
  // through into AppMetadata so the listing tool always has a reliable
  // baseline even when Firecrawl + HTML extraction both degrade.
  description?: string;
  releaseNotes?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
}

async function lookupOnce(
  appId: string,
  country: string,
  timeoutMs: number,
): Promise<ITunesResult | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const url = `${ITUNES_LOOKUP}?id=${encodeURIComponent(appId)}&country=${encodeURIComponent(country)}`;
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`iTunes lookup HTTP ${res.status}`);
    }
    const json = (await res.json()) as { resultCount?: number; results?: ITunesResult[] };
    return json.results?.[0];
  } finally {
    clearTimeout(timer);
  }
}

export async function runFetchAppMetadata(input: {
  appId: string;
  storefront: string;
}): Promise<AppMetadata> {
  const env = getEnv();
  const metrics = getMetrics();
  const logger = getLogger();

  const tryCountries = Array.from(
    new Set([input.storefront.toLowerCase(), "us"]),
  );

  let result: ITunesResult | undefined;
  let resolvedStorefront = input.storefront.toLowerCase();

  for (const country of tryCountries) {
    try {
      const lookup = await pRetry(
        () => lookupOnce(input.appId, country, env.METADATA_TIMEOUT_MS),
        { retries: 2, minTimeout: 300, maxTimeout: 1200 },
      );
      if (lookup?.trackId) {
        result = lookup;
        resolvedStorefront = country;
        break;
      }
    } catch (err) {
      logger.warn(
        { appId: input.appId, country, err: (err as Error).message },
        "iTunes lookup failed for storefront",
      );
      metrics.increment("itunes_lookup.error", { country });
    }
  }

  if (!result) {
    throw new Error(
      `No App Store result for id=${input.appId} in storefronts ${tryCountries.join(", ")}.`,
    );
  }

  const meta: AppMetadata = {
    appId: String(result.trackId ?? input.appId),
    storefront: resolvedStorefront,
    trackName: result.trackName ?? "(unknown)",
    artistName: result.artistName ?? "(unknown developer)",
    bundleId: result.bundleId,
    primaryGenreName: result.primaryGenreName,
    // iTunes returns primaryGenreId as a number and genreIds as string[].
    // Normalize both to string for downstream consumers (competitor scan).
    primaryGenreId:
      typeof result.primaryGenreId === "number"
        ? String(result.primaryGenreId)
        : result.genreIds?.[0],
    genreIds: Array.isArray(result.genreIds)
      ? result.genreIds.filter((g): g is string => typeof g === "string")
      : undefined,
    genres: result.genres ?? [],
    artworkUrl:
      result.artworkUrl512 ??
      result.artworkUrl100 ??
      "https://apps.apple.com/favicon.ico",
    appStoreUrl:
      result.trackViewUrl ??
      `https://apps.apple.com/${resolvedStorefront}/app/id${input.appId}`,
    averageUserRating: result.averageUserRating ?? null,
    userRatingCount: result.userRatingCount ?? null,
    price: result.price ?? null,
    currency: result.currency ?? null,
    contentAdvisoryRating: result.contentAdvisoryRating ?? null,
    releaseDate: result.releaseDate ?? null,
    version: result.version ?? null,
    minimumOsVersion: result.minimumOsVersion ?? null,
    itunesDescription: result.description ?? null,
    itunesReleaseNotes: result.releaseNotes ?? null,
    itunesScreenshotUrls: Array.isArray(result.screenshotUrls)
      ? result.screenshotUrls.filter((u): u is string => typeof u === "string")
      : undefined,
    itunesIpadScreenshotUrls: Array.isArray(result.ipadScreenshotUrls)
      ? result.ipadScreenshotUrls.filter((u): u is string => typeof u === "string")
      : undefined,
  };

  metrics.increment("itunes_lookup.success", { country: resolvedStorefront });
  return AppMetadataSchema.parse(meta);
}

export const fetchAppMetadataTool = createTool({
  id: "fetch-app-metadata",
  description:
    "Fetches surface metadata for a parsed App Store listing using Apple's iTunes Lookup endpoint. Falls back to the US storefront if the requested storefront returns no result.",
  inputSchema: z.object({
    appId: z.string(),
    storefront: z.string().default("us"),
  }),
  outputSchema: AppMetadataSchema,
  execute: async (inputData) =>
    runFetchAppMetadata({
      appId: inputData.appId,
      storefront: inputData.storefront ?? "us",
    }),
});
