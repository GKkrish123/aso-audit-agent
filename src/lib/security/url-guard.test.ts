import { describe, it, expect } from "vitest";
import {
  parseAppStoreUrl,
  isLikelyAppStoreUrl,
  InvalidAppStoreUrlError,
} from "./url-guard";

describe("parseAppStoreUrl", () => {
  it("parses canonical Spotify URL", () => {
    const r = parseAppStoreUrl(
      "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580",
    );
    expect(r.appId).toBe("324684580");
    expect(r.storefront).toBe("us");
    expect(r.slug).toBe("spotify-music-and-podcasts");
    expect(r.canonicalUrl).toBe(
      "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580",
    );
  });

  it("parses URL without slug", () => {
    const r = parseAppStoreUrl("https://apps.apple.com/in/app/id324684580");
    expect(r.appId).toBe("324684580");
    expect(r.storefront).toBe("in");
    expect(r.slug).toBeUndefined();
  });

  it("parses URL with global storefront default", () => {
    const r = parseAppStoreUrl("https://apps.apple.com/app/id123456789");
    expect(r.appId).toBe("123456789");
    expect(r.storefront).toBe("us");
  });

  it("accepts URLs without protocol", () => {
    const r = parseAppStoreUrl("apps.apple.com/us/app/id324684580");
    expect(r.appId).toBe("324684580");
  });

  it("rejects non-Apple hosts (SSRF guard)", () => {
    expect(() => parseAppStoreUrl("https://evil.example.com/app/id123")).toThrow(
      InvalidAppStoreUrlError,
    );
  });

  it("rejects empty input", () => {
    expect(() => parseAppStoreUrl("   ")).toThrow(InvalidAppStoreUrlError);
  });

  it("rejects URLs without an id segment", () => {
    expect(() =>
      parseAppStoreUrl("https://apps.apple.com/us/app/spotify"),
    ).toThrow(InvalidAppStoreUrlError);
  });

  it("isLikelyAppStoreUrl returns false for invalid input", () => {
    expect(isLikelyAppStoreUrl("not a url")).toBe(false);
    expect(isLikelyAppStoreUrl("https://google.com")).toBe(false);
  });

  it("isLikelyAppStoreUrl returns true for valid Apple URL", () => {
    expect(
      isLikelyAppStoreUrl(
        "https://apps.apple.com/us/app/spotify/id324684580",
      ),
    ).toBe(true);
  });
});
