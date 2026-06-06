import { describe, it, expect } from "vitest";
import {
  extractFromAppStoreHtml,
  extractFromAppStoreMarkdown,
  mergeListingSources,
} from "./extractors";

describe("extractFromAppStoreHtml", () => {
  it("extracts JSON-LD title and description", () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "SoftwareApplication",
        name: "Test App",
        description: "A great test app.",
      })}</script>
    </head><body></body></html>`;
    const out = extractFromAppStoreHtml(html);
    expect(out.title).toBe("Test App");
    expect(out.description).toBe("A great test app.");
  });

  it("falls back to meta description", () => {
    const html = `<!DOCTYPE html><html><head>
      <meta name="description" content="Fallback description here."/>
    </head><body></body></html>`;
    const out = extractFromAppStoreHtml(html);
    expect(out.description).toBe("Fallback description here.");
  });

  it("returns empty object for empty HTML", () => {
    const out = extractFromAppStoreHtml("<html><body></body></html>");
    expect(out.title).toBeUndefined();
    expect(out.hasAppPreviewVideo).toBe(false);
  });
});

describe("mergeListingSources", () => {
  it("prefers iTunes for title, HTML for long-form text when present", () => {
    const merged = mergeListingSources(
      { title: "iTunes Title" },
      {
        title: "HTML Title",
        description: "HTML body text",
        subtitle: "HTML subtitle",
      },
      {
        description: "Firecrawl body text",
        subtitle: "Firecrawl subtitle",
      },
    );
    expect(merged.title).toBe("iTunes Title");
    expect(merged.subtitle).toBe("HTML subtitle");
    expect(merged.description).toBe("HTML body text");
  });

  it("falls back to Firecrawl for long-form text when HTML is missing it", () => {
    const merged = mergeListingSources(
      { title: "iTunes Title" },
      { title: "HTML Title" },
      {
        description: "Firecrawl body text",
        subtitle: "Firecrawl subtitle",
      },
    );
    expect(merged.subtitle).toBe("Firecrawl subtitle");
    expect(merged.description).toBe("Firecrawl body text");
  });

  it("falls back to HTML for long-form text when Firecrawl missed", () => {
    const merged = mergeListingSources(
      { title: "iTunes Title" },
      { description: "HTML body text" },
      {},
    );
    expect(merged.description).toBe("HTML body text");
  });

  it("uses iTunes title even when Firecrawl/HTML provide one", () => {
    const merged = mergeListingSources(
      { title: "iTunes Title" },
      { title: "HTML Title" },
      { title: "Firecrawl Title" },
    );
    expect(merged.title).toBe("iTunes Title");
  });

  it("never lets empty strings overwrite populated values", () => {
    const merged = mergeListingSources(
      { title: "Real title" },
      { title: "" },
    );
    expect(merged.title).toBe("Real title");
  });
});

describe("extractFromAppStoreMarkdown", () => {
  const sample = `# Snapchat

Share the moment!

Free · In‑App Purchases

- [5.8M Ratings\\\\\n\\\\\n4.5](https://apps.apple.com/us/app/snapchat/id447188370#productRatings)

- [Developer\\\\\n\\\\\nSnap, Inc.](https://apps.apple.com/us/developer/snap-inc/id446889612?platform=iphone)

- ![](https://apps.apple.com/assets/artwork/1x1.gif)

iPhone, iPad, Apple Watch, iMessage

Snapchat is a fast and fun way to share the moment with your friends and family

SNAP
• Snapchat opens right to the Camera — just tap to take a photo, or press and hold for video.
• Express yourself with Lenses, Filters, Bitmoji and more!

CHAT
• Stay in touch with friends through live messaging.

## What's New

- Bug fixes and performance improvements.
- New Lenses added.

[**Ratings & Reviews**](https://apps.apple.com/us/app/447188370?see-all=reviews&platform=iphone)

- 4.5
`;

  it("extracts title from the H1", () => {
    const out = extractFromAppStoreMarkdown(sample);
    expect(out.title).toBe("Snapchat");
  });

  it("extracts the subtitle line under the title", () => {
    const out = extractFromAppStoreMarkdown(sample);
    expect(out.subtitle).toBe("Share the moment!");
  });

  it("uses the first paragraph after compatibility as promotional text", () => {
    const out = extractFromAppStoreMarkdown(sample);
    expect(out.promotionalText).toBe(
      "Snapchat is a fast and fun way to share the moment with your friends and family",
    );
  });

  it("preserves description section headers and bullets", () => {
    const out = extractFromAppStoreMarkdown(sample);
    expect(out.description).toContain("SNAP");
    expect(out.description).toContain("• Express yourself with Lenses");
    expect(out.description).toContain("CHAT");
    expect(out.description).not.toContain("What's New");
    expect(out.description).not.toContain("Ratings & Reviews");
  });

  it("extracts the What's New block as releaseNotes", () => {
    const out = extractFromAppStoreMarkdown(sample);
    expect(out.releaseNotes).toContain("Bug fixes");
    expect(out.releaseNotes).toContain("New Lenses");
  });

  it("returns an empty object on empty input", () => {
    expect(extractFromAppStoreMarkdown("")).toEqual({});
  });

  it("pulls ogImage from metadata when it points at Apple's CDN", () => {
    const out = extractFromAppStoreMarkdown(sample, {
      ogImage: "https://is1-ssl.mzstatic.com/image/thumb/abc/1200x630wa.jpg",
    });
    expect(out.screenshotUrls).toEqual([
      "https://is1-ssl.mzstatic.com/image/thumb/abc/1200x630wa.jpg",
    ]);
  });

  it("ignores ogImage that isn't on Apple's CDN", () => {
    const out = extractFromAppStoreMarkdown(sample, {
      ogImage: "https://random.cdn.example/share.jpg",
    });
    expect(out.screenshotUrls).toBeUndefined();
  });
});
