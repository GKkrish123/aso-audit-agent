import * as cheerio from "cheerio";

export interface ExtractedListing {
  title?: string;
  subtitle?: string;
  description?: string;
  releaseNotes?: string;
  promotionalText?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
  hasAppPreviewVideo?: boolean;
  appPreviewVideoUrls?: string[];
  appPreviewVideoPosters?: string[];
}

interface AppleArtwork {
  $kind?: "Artwork";
  template?: string;
  width?: number;
  height?: number;
  variants?: Array<{ format?: string }>;
}

interface AppleVideo {
  $kind?: "Video";
  videoUrl?: string;
  preview?: AppleArtwork;
}

interface AppleMediaItem {
  $kind?: string;
  screenshot?: AppleArtwork;
  video?: AppleVideo;
}

function renderArtworkTemplate(
  art: AppleArtwork | undefined,
  opts: { width: number; height: number; crop?: string; format?: string },
): string | undefined {
  if (!art?.template) return undefined;
  const format =
    opts.format ?? art.variants?.[0]?.format ?? "webp";
  return art.template
    .replace("{w}", String(opts.width))
    .replace("{h}", String(opts.height))
    .replace("{c}", opts.crop ?? "bb")
    .replace("{f}", format);
}

const IPHONE_SCREENSHOT_DIMS = { width: 600, height: 1066, crop: "bb", format: "webp" };
const IPAD_SCREENSHOT_DIMS = { width: 720, height: 960, crop: "bb", format: "webp" };
const VIDEO_POSTER_DIMS = { width: 600, height: 1066, crop: "bb", format: "jpg" };

function shelvesMatching(
  shelfMapping: Record<string, unknown> | undefined,
  predicate: (key: string) => boolean,
): AppleMediaItem[] {
  if (!shelfMapping) return [];
  const out: AppleMediaItem[] = [];
  for (const [key, shelf] of Object.entries(shelfMapping)) {
    if (!predicate(key)) continue;
    const items = (shelf as { items?: unknown })?.items;
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it && typeof it === "object") out.push(it as AppleMediaItem);
      }
    }
  }
  return out;
}

export function extractFromAppStoreSerializedData(html: string): ExtractedListing {
  const out: ExtractedListing = {};
  if (!html) return out;

  const match =
    html.match(
      /<script[^>]*\bid="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/i,
    ) ??
    html.match(
      /<script[^>]*\btype="application\/json"[^>]*\bid="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/i,
    );
  if (!match) return out;

  let payload: unknown;
  try {
    payload = JSON.parse(match[1].trim());
  } catch {
    return out;
  }

  const dataArr = Array.isArray(payload)
    ? payload
    : (payload as { data?: unknown }).data;
  if (!Array.isArray(dataArr) || dataArr.length === 0) return out;

  const root = (dataArr[0] as { data?: Record<string, unknown> } | undefined)?.data;
  if (!root || typeof root !== "object") return out;

  const shelfMapping = root.shelfMapping as Record<string, unknown> | undefined;

  const lockup = root.lockup as
    | { title?: string; subtitle?: string }
    | undefined;
  if (typeof lockup?.title === "string" && lockup.title.trim()) {
    out.title = lockup.title.trim();
  }
  if (typeof lockup?.subtitle === "string" && lockup.subtitle.trim()) {
    out.subtitle = lockup.subtitle.trim();
  }
  if (!out.title && typeof root.title === "string") {
    out.title = (root.title as string).trim();
  }

  const descShelf = shelfMapping?.description as
    | { items?: Array<{ paragraph?: { text?: string } }> }
    | undefined;
  const descText = descShelf?.items?.[0]?.paragraph?.text;
  if (typeof descText === "string" && descText.trim()) {
    out.description = descText.trim();
  } else if (shelfMapping) {
    for (const v of Object.values(shelfMapping)) {
      const shelf = v as {
        contentType?: string;
        items?: Array<{ paragraph?: { text?: string } }>;
      };
      if (shelf?.contentType === "productDescription") {
        const t = shelf.items?.[0]?.paragraph?.text;
        if (typeof t === "string" && t.trim()) {
          out.description = t.trim();
          break;
        }
      }
    }
  }

  const recentShelf = shelfMapping?.mostRecentVersion as
    | { items?: Array<{ text?: string }> }
    | undefined;
  const recentText = recentShelf?.items?.[0]?.text;
  if (typeof recentText === "string" && recentText.trim()) {
    out.releaseNotes = recentText.trim();
  }

  const phoneItems = shelvesMatching(shelfMapping, (k) =>
    /product_media_phone/i.test(k),
  );
  const iphoneShots: string[] = [];
  const videoEntries: Array<{ url: string; poster: string }> = [];
  for (const item of phoneItems) {
    if (item.video?.videoUrl) {
      const poster = renderArtworkTemplate(item.video.preview, VIDEO_POSTER_DIMS) ?? "";
      if (!videoEntries.some((e) => e.url === item.video!.videoUrl)) {
        videoEntries.push({ url: item.video.videoUrl, poster });
      }
      if (poster) iphoneShots.push(poster);
    }
    if (item.screenshot) {
      const url = renderArtworkTemplate(item.screenshot, IPHONE_SCREENSHOT_DIMS);
      if (url) iphoneShots.push(url);
    }
  }
  if (iphoneShots.length > 0) out.screenshotUrls = [...new Set(iphoneShots)];
  if (videoEntries.length > 0) {
    out.appPreviewVideoUrls = videoEntries.map((e) => e.url);
    out.appPreviewVideoPosters = videoEntries.map((e) => e.poster);
    out.hasAppPreviewVideo = true;
  } else {
    out.hasAppPreviewVideo = false;
  }

  const padItems = shelvesMatching(shelfMapping, (k) =>
    /product_media_pad/i.test(k),
  );
  const ipadShots: string[] = [];
  for (const item of padItems) {
    if (item.screenshot) {
      const url = renderArtworkTemplate(item.screenshot, IPAD_SCREENSHOT_DIMS);
      if (url) ipadShots.push(url);
    }
  }
  if (ipadShots.length > 0) out.ipadScreenshotUrls = [...new Set(ipadShots)];

  return out;
}

export function extractFromAppStoreMarkdown(
  markdown: string,
  metadata?: Record<string, unknown>,
): ExtractedListing {
  const out: ExtractedListing = {};
  if (!markdown || typeof markdown !== "string") return out;

  const h1 = markdown.match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) out.title = h1[1].trim();

  if (h1?.index !== undefined) {
    const tail = markdown.slice(h1.index + h1[0].length);
    const candidate = tail
      .split("\n")
      .map((l) => l.trim())
      .find(
        (l) =>
          l.length > 0 &&
          !/^#/.test(l) &&
          !/^(Free|Get|\$\d|In[\u2011-]App|Free\s+·|Get\s+·)/i.test(l),
      );
    if (candidate) out.subtitle = candidate;
  }

  const compatRe = /^(iPhone|iPad|Apple Watch|Apple TV|Mac)[^\n]*$/m;
  const compatMatch = markdown.match(compatRe);
  const bodyStart =
    compatMatch?.index !== undefined
      ? markdown.indexOf("\n", compatMatch.index) + 1
      : 0;

  const stoppers: RegExp[] = [
    /\n\[\*\*Ratings\s*&\s*Reviews\*\*\]/i,
    /\n#{1,3}\s+What['\u2019]s New\b/i,
    /\n#{1,3}\s+Information\b/i,
    /\n#{1,3}\s+Editors['\u2019]\s+Choice\b/i,
    /\n#{1,3}\s+In[\u2011-]App\s+Purchases\b/i,
  ];
  let bodyEnd = markdown.length;
  for (const re of stoppers) {
    const after = markdown.slice(bodyStart);
    const m = after.match(re);
    if (m?.index !== undefined) {
      bodyEnd = Math.min(bodyEnd, bodyStart + m.index);
    }
  }
  const bodyRaw = markdown.slice(bodyStart, bodyEnd).trim();

  if (bodyRaw) {
    const paragraphs = bodyRaw
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length > 0) out.promotionalText = paragraphs[0];
    if (paragraphs.length > 1) {
      out.description = paragraphs.slice(1).join("\n\n");
    } else if (paragraphs.length === 1) {
      out.description = paragraphs[0];
    }
  }

  const whatsNew = markdown.match(
    /#{1,3}\s+What['\u2019]s New[^\n]*\n+([\s\S]*?)(?=\n#{1,3}\s|\n\[\*\*|\n---|$)/i,
  );
  if (whatsNew?.[1]) {
    const notes = whatsNew[1].replace(/^[-*]\s+/gm, "• ").trim();
    if (notes) out.releaseNotes = notes;
  }

  if (metadata) {
    const ogImage = (metadata as Record<string, unknown>).ogImage;
    if (typeof ogImage === "string" && /mzstatic\.com/.test(ogImage)) {
      out.screenshotUrls = [ogImage];
    }
  }

  return out;
}

function extractFromAppStoreLegacyHtml(html: string): ExtractedListing {
  const $ = cheerio.load(html);
  const out: ExtractedListing = {};

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item?.["@type"] === "SoftwareApplication" || item?.name) {
          if (!out.title && typeof item.name === "string") {
            out.title = item.name;
          }
          if (!out.description && typeof item.description === "string") {
            out.description = item.description;
          }
          if (
            item.image &&
            Array.isArray(item.image) &&
            !out.screenshotUrls
          ) {
            out.screenshotUrls = item.image.filter(
              (s: unknown): s is string => typeof s === "string",
            );
          }
        }
      }
    } catch {
    }
  });

  if (!out.description) {
    const metaDesc = $('meta[name="description"]').attr("content");
    if (metaDesc) out.description = metaDesc;
  }

  if (!out.title) {
    const headerTitle = $("h1.product-header__title").text().trim();
    if (headerTitle) out.title = headerTitle.split(/\n/)[0]?.trim();
  }
  const subtitle = $("h2.product-header__subtitle").text().trim();
  if (subtitle) out.subtitle = subtitle;

  const descSection = $("section.section--description div.we-truncate p")
    .map((_, p) => $(p).text().trim())
    .get()
    .filter(Boolean)
    .join("\n\n");
  if (descSection) out.description = descSection;

  const releaseNotes = $("section.whats-new div.we-truncate p")
    .map((_, p) => $(p).text().trim())
    .get()
    .filter(Boolean)
    .join("\n\n");
  if (releaseNotes) out.releaseNotes = releaseNotes;

  const iphoneShots = new Set<string>();
  const ipadShots = new Set<string>();
  $("picture.we-artwork--screenshot-platform-iphone source").each((_, el) => {
    const set = $(el).attr("srcset");
    if (set) {
      const first = set.split(",")[0]?.trim().split(" ")[0];
      if (first) iphoneShots.add(first);
    }
  });
  $("picture.we-artwork--screenshot-platform-ipad source").each((_, el) => {
    const set = $(el).attr("srcset");
    if (set) {
      const first = set.split(",")[0]?.trim().split(" ")[0];
      if (first) ipadShots.add(first);
    }
  });
  if (iphoneShots.size > 0) out.screenshotUrls = [...iphoneShots];
  if (ipadShots.size > 0) out.ipadScreenshotUrls = [...ipadShots];

  const previews: string[] = [];
  $("video[src], source[type='video/mp4']").each((_, el) => {
    const src = $(el).attr("src");
    if (src) previews.push(src);
  });
  if (previews.length > 0) {
    out.hasAppPreviewVideo = true;
    out.appPreviewVideoUrls = [...new Set(previews)];
  } else if (out.hasAppPreviewVideo === undefined) {
    out.hasAppPreviewVideo = false;
  }

  return out;
}

export function extractFromAppStoreHtml(html: string): ExtractedListing {
  const fromJson = extractFromAppStoreSerializedData(html);
  const fromLegacy = extractFromAppStoreLegacyHtml(html);
  return overlayListings(fromJson, fromLegacy);
}

function overlayListings(
  primary: ExtractedListing,
  secondary: ExtractedListing,
): ExtractedListing {
  const out: ExtractedListing = { ...secondary };
  for (const [k, v] of Object.entries(primary) as Array<
    [keyof ExtractedListing, unknown]
  >) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim().length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function mergeListingSources(
  itunes: Partial<ExtractedListing>,
  html: Partial<ExtractedListing>,
  firecrawl?: Partial<ExtractedListing>,
): ExtractedListing {
  const out: ExtractedListing = {};

  const candidates = [itunes, html, firecrawl].filter(
    Boolean,
  ) as Partial<ExtractedListing>[];

  const pickString = (key: keyof ExtractedListing, order: number[]): void => {
    for (const i of order) {
      const v = candidates[i]?.[key];
      if (typeof v === "string" && v.trim().length > 0) {
        (out as Record<string, unknown>)[key] = v;
        return;
      }
    }
  };

  const pickArray = (key: keyof ExtractedListing, order: number[]): void => {
    for (const i of order) {
      const v = candidates[i]?.[key];
      if (Array.isArray(v) && v.length > 0) {
        (out as Record<string, unknown>)[key] = v;
        return;
      }
    }
  };

  pickString("title", [0, 2, 1]);
  pickString("subtitle", [1, 2, 0]);
  pickString("description", [1, 2, 0]);
  pickString("releaseNotes", [1, 2, 0]);
  pickString("promotionalText", [1, 2, 0]);
  pickArray("screenshotUrls", [1, 2, 0]);
  pickArray("ipadScreenshotUrls", [1, 2, 0]);
  pickArray("appPreviewVideoUrls", [1, 2, 0]);
  pickArray("appPreviewVideoPosters", [1, 2, 0]);

  out.hasAppPreviewVideo =
    !!(out.appPreviewVideoUrls && out.appPreviewVideoUrls.length > 0) ||
    candidates.some((c) => c?.hasAppPreviewVideo === true);

  return out;
}
