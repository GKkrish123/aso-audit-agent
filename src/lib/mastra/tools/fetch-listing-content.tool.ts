import { createTool } from "@mastra/core/tools";
import pRetry from "p-retry";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getLogger } from "@/lib/observability/logger";
import { getMetrics } from "@/lib/observability/metrics";
import {
  extractFromAppStoreHtml,
  extractFromAppStoreMarkdown,
  mergeListingSources,
  type ExtractedListing,
} from "@/lib/aso/extractors";
import {
  AppMetadataSchema,
  ListingContentSchema,
  type AppMetadata,
  type ListingContent,
} from "@/types/audit";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`App Store HTML HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirecrawl(
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<ExtractedListing | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: false,
        "maxAge": 172800000,
        "parsers": [
            "pdf"
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Firecrawl HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        markdown?: string;
        html?: string;
        metadata?: Record<string, unknown>;
      };
    };
    if (!json?.data) return undefined;

    // Prefer the markdown view: it is structurally clean (no JS-rendered
    // shoebox blobs, no inline tracking attributes) and the layout is stable
    // enough to extract title / subtitle / promo text / description /
    // what's-new with regex. Fall back to HTML extraction only if Firecrawl
    // didn't return any markdown for this URL.
    if (json.data.markdown?.trim()) {
      return extractFromAppStoreMarkdown(json.data.markdown, json.data.metadata);
    }
    if (json.data.html) {
      return extractFromAppStoreHtml(json.data.html);
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function runFetchListingContent(input: {
  appId: string;
  storefront: string;
  canonicalUrl: string;
  metadata: AppMetadata;
}): Promise<ListingContent> {
  const env = getEnv();
  const logger = getLogger();
  const metrics = getMetrics();

  // Firecrawl markdown returns 1x1.gif placeholder screenshots, so iTunes is
  // the only reliable screenshot source through this pipeline.
  const itunesListing: ExtractedListing = {
    title: input.metadata.trackName,
    description: input.metadata.itunesDescription ?? undefined,
    releaseNotes: input.metadata.itunesReleaseNotes ?? undefined,
    screenshotUrls: input.metadata.itunesScreenshotUrls,
    ipadScreenshotUrls: input.metadata.itunesIpadScreenshotUrls,
  };

  let firecrawlListing: ExtractedListing | undefined;
  let firecrawlSourceOk = false;
  if (env.FIRECRAWL_API_KEY) {
    try {
      firecrawlListing = await pRetry(
        () =>
          fetchFirecrawl(
            input.canonicalUrl,
            env.FIRECRAWL_API_KEY!,
            env.LISTING_TIMEOUT_MS,
          ),
        { retries: 2, minTimeout: 500, maxTimeout: 2000 },
      );
      firecrawlSourceOk = !!(
        firecrawlListing?.description || firecrawlListing?.title
      );
      metrics.increment("listing.firecrawl.success");
    } catch (err) {
      logger.warn(
        { url: input.canonicalUrl, err: (err as Error).message },
        "Firecrawl extraction failed; will fall back to direct HTML",
      );
      metrics.increment("listing.firecrawl.error");
    }
  }

  let htmlListing: ExtractedListing = {};
  if (!firecrawlSourceOk) {
    try {
      const html = await pRetry(
        () => fetchHtml(input.canonicalUrl, env.LISTING_TIMEOUT_MS),
        { retries: 2, minTimeout: 400, maxTimeout: 1500 },
      );
      htmlListing = extractFromAppStoreHtml(html);
      metrics.increment("listing.html.success");
    } catch (err) {
      logger.warn(
        { url: input.canonicalUrl, err: (err as Error).message },
        "App Store HTML extraction failed",
      );
      metrics.increment("listing.html.error");
    }
  }

  const merged = mergeListingSources(itunesListing, htmlListing, firecrawlListing);

  const longTextSource: ListingContent["sources"]["longText"] = merged.description
    ? firecrawlListing?.description
      ? "firecrawl"
      : htmlListing.description
        ? "html"
        : "itunes"
    : "none";

  const screenshotSource: ListingContent["sources"]["screenshots"] = merged.screenshotUrls?.length
    ? itunesListing?.screenshotUrls?.length
      ? "itunes"
      : firecrawlListing?.screenshotUrls?.length
        ? "firecrawl"
        : "html"
    : "none";

  const result: ListingContent = {
    title: merged.title ?? input.metadata.trackName,
    subtitle: merged.subtitle ?? null,
    description: merged.description ?? "",
    releaseNotes: merged.releaseNotes ?? null,
    promotionalText: merged.promotionalText ?? null,
    screenshotUrls: merged.screenshotUrls ?? [],
    ipadScreenshotUrls: merged.ipadScreenshotUrls ?? [],
    hasAppPreviewVideo: !!merged.hasAppPreviewVideo,
    appPreviewVideoUrls: merged.appPreviewVideoUrls ?? [],
    sources: {
      metadata: "itunes",
      longText: longTextSource,
      screenshots: screenshotSource,
    },
  };

  return ListingContentSchema.parse(result);
}

export const fetchListingContentTool = createTool({
  id: "fetch-listing-content",
  description:
    "Fetches the full listing content for an App Store page (title, subtitle, promotional text, description, release notes, screenshots, app preview video). When FIRECRAWL_API_KEY is set, Firecrawl markdown extraction is the primary source and direct HTML scraping is the fallback; otherwise direct HTML extraction is used. iTunes metadata is always merged in as a baseline.",
  inputSchema: z.object({
    appId: z.string(),
    storefront: z.string(),
    canonicalUrl: z.string().url(),
    metadata: AppMetadataSchema,
  }),
  outputSchema: ListingContentSchema,
  execute: async (inputData) => runFetchListingContent(inputData),
});
