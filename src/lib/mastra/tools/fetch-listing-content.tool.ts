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
        // Request BOTH formats. The serialized-server-data JSON blob (only
        // available in the HTML response) is the only source of truth for
        // screenshots and preview videos on the modern Svelte-rendered App
        // Store page. Markdown remains useful as a fallback when the HTML
        // is too sanitized or the blob is missing.
        formats: ["markdown", "html"],
        onlyMainContent: false,
        maxAge: 172800000,
        parsers: ["pdf"],
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

    // Strategy: HTML extraction (serialized-data + cheerio overlay) is the
    // richest source — it returns title, subtitle, description, what's new,
    // every screenshot, AND preview videos. Markdown is only a degraded
    // fallback (no media, no subtitle reliably). Overlay markdown on top of
    // HTML only for fields the HTML didn't have, so we never lose media to
    // the markdown's 1x1.gif placeholders.
    const fromHtml = json.data.html
      ? extractFromAppStoreHtml(json.data.html)
      : undefined;
    const fromMd = json.data.markdown?.trim()
      ? extractFromAppStoreMarkdown(json.data.markdown, json.data.metadata)
      : undefined;
    if (fromHtml && fromMd) {
      // HTML wins for media + structured fields; markdown only fills
      // promotionalText (which the JSON blob doesn't carry separately).
      return {
        ...fromHtml,
        promotionalText: fromHtml.promotionalText ?? fromMd.promotionalText,
      };
    }
    return fromHtml ?? fromMd;
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
    const startedAt = performance.now();
    logger.info(
      {
        url: input.canonicalUrl,
        hop: "listing.firecrawl",
        phase: "start",
        timeoutMs: env.LISTING_TIMEOUT_MS,
      },
      "\u25b6 firecrawl scrape",
    );
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
      logger.info(
        {
          url: input.canonicalUrl,
          hop: "listing.firecrawl",
          phase: "end",
          ok: true,
          durationMs: Math.round(performance.now() - startedAt),
          hasTitle: !!firecrawlListing?.title,
          hasDescription: !!firecrawlListing?.description,
          descriptionChars: firecrawlListing?.description?.length ?? 0,
        },
        `\u2713 firecrawl scrape (${Math.round(performance.now() - startedAt)}ms)`,
      );
    } catch (err) {
      logger.warn(
        {
          url: input.canonicalUrl,
          hop: "listing.firecrawl",
          phase: "end",
          ok: false,
          durationMs: Math.round(performance.now() - startedAt),
          err: (err as Error).message,
        },
        "Firecrawl extraction failed; will fall back to direct HTML",
      );
      metrics.increment("listing.firecrawl.error");
    }
  }

  let htmlListing: ExtractedListing = {};
  if (!firecrawlSourceOk) {
    const startedAt = performance.now();
    logger.info(
      {
        url: input.canonicalUrl,
        hop: "listing.html",
        phase: "start",
        timeoutMs: env.LISTING_TIMEOUT_MS,
      },
      "\u25b6 app store HTML fetch",
    );
    try {
      const html = await pRetry(
        () => fetchHtml(input.canonicalUrl, env.LISTING_TIMEOUT_MS),
        { retries: 2, minTimeout: 400, maxTimeout: 1500 },
      );
      htmlListing = extractFromAppStoreHtml(html);
      metrics.increment("listing.html.success");
      logger.info(
        {
          url: input.canonicalUrl,
          hop: "listing.html",
          phase: "end",
          ok: true,
          durationMs: Math.round(performance.now() - startedAt),
          htmlBytes: html.length,
          hasDescription: !!htmlListing.description,
        },
        `\u2713 app store HTML fetch (${Math.round(performance.now() - startedAt)}ms)`,
      );
    } catch (err) {
      logger.warn(
        {
          url: input.canonicalUrl,
          hop: "listing.html",
          phase: "end",
          ok: false,
          durationMs: Math.round(performance.now() - startedAt),
          err: (err as Error).message,
        },
        "App Store HTML extraction failed",
      );
      metrics.increment("listing.html.error");
    }
  }

  const merged = mergeListingSources(itunesListing, htmlListing, firecrawlListing);

  // Source attribution must mirror the merge precedence in
  // mergeListingSources: html > firecrawl > itunes for long text & media.
  // Both Firecrawl and direct HTML hit the same serialized-server-data blob
  // (Apple's modern Svelte page), so screenshots from either are equally
  // real — the old "firecrawl returns placeholders" caveat no longer applies
  // once we parse the serialized JSON.
  const longTextSource: ListingContent["sources"]["longText"] = merged.description
    ? htmlListing.description
      ? "html"
      : firecrawlListing?.description
        ? "firecrawl"
        : "itunes"
    : "none";

  const screenshotSource: ListingContent["sources"]["screenshots"] = merged.screenshotUrls?.length
    ? htmlListing.screenshotUrls?.length
      ? "html"
      : firecrawlListing?.screenshotUrls?.length
        ? "firecrawl"
        : "itunes"
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
    appPreviewVideoPosters: merged.appPreviewVideoPosters ?? [],
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
