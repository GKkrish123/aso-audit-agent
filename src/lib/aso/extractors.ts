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
    // First paragraph is promotional text; remaining paragraphs are the description.
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
    const notes = whatsNew[1]
      .replace(/^[-*]\s+/gm, "• ")
      .trim();
    if (notes) out.releaseNotes = notes;
  }

  // Markdown uses 1x1.gif placeholders; og:image is reliable only on Apple's CDN.
  console.log("metadata", metadata);
  
  if (metadata) {
    const ogImage = (metadata as Record<string, unknown>).ogImage;
    if (typeof ogImage === "string" && /mzstatic\.com/.test(ogImage)) {
      out.screenshotUrls = [ogImage];
    }
  }

  return out;
}

export function extractFromAppStoreHtml(html: string): ExtractedListing {
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
          if (item.image && Array.isArray(item.image) && !out.screenshotUrls) {
            out.screenshotUrls = item.image.filter(
              (s: unknown): s is string => typeof s === "string",
            );
          }
        }
      }
    } catch {
      // ignore parse errors per-block
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
  } else {
    out.hasAppPreviewVideo = false;
  }

  return out;
}

// Source precedence: title itunes > firecrawl > html; long text/media firecrawl > html > itunes.
// Indices: itunes=0, html=1, firecrawl=2. Empty values never overwrite a populated field.
export function mergeListingSources(
  itunes: Partial<ExtractedListing>,
  html: Partial<ExtractedListing>,
  firecrawl?: Partial<ExtractedListing>,
): ExtractedListing {
  const out: ExtractedListing = {};
  const candidates = [itunes, html, firecrawl].filter(Boolean) as Partial<ExtractedListing>[];

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

  console.log("itunes", itunes);
  

  pickString("title", [0, 2, 1]);
  pickString("subtitle", [2, 1, 0]);
  pickString("description", [2, 1, 0]);
  pickString("releaseNotes", [2, 1, 0]);
  pickString("promotionalText", [2, 1, 0]);
  pickArray("screenshotUrls", [0, 2, 1]);
  pickArray("ipadScreenshotUrls", [0, 2, 1]);
  pickArray("appPreviewVideoUrls", [2, 1, 0]);

  out.hasAppPreviewVideo =
    !!(out.appPreviewVideoUrls && out.appPreviewVideoUrls.length > 0) ||
    candidates.some((c) => c?.hasAppPreviewVideo === true);

  return out;
}
