import { describe, expect, it } from "vitest";

import {
  isAllowedApplePreviewUrl,
  isMasterPlaylist,
  resolveApplePreviewTarget,
  rewritePlaylistForProxy,
} from "@/lib/media/apple-preview-proxy";

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-stereo-128",URI="https://apptrailers.itunes.apple.com/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2529112,RESOLUTION=520x1128,AUDIO="audio-stereo-128"
https://apptrailers.itunes.apple.com/itunes-assets/variant-high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=419164,RESOLUTION=244x530,AUDIO="audio-stereo-128"
https://apptrailers.itunes.apple.com/itunes-assets/variant-low.m3u8`;

const VARIANT = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="segment.mp4",BYTERANGE="879@0"
#EXTINF:4.66667,
#EXT-X-BYTERANGE:110897@879
segment.mp4`;

describe("apple-preview-proxy", () => {
  it("allows only apptrailers.itunes.apple.com HTTPS URLs", () => {
    expect(
      isAllowedApplePreviewUrl(
        "https://apptrailers.itunes.apple.com/itunes-assets/foo.m3u8",
      ),
    ).toBe(true);
    expect(isAllowedApplePreviewUrl("https://evil.example.com/foo.m3u8")).toBe(
      false,
    );
  });

  it("unwraps nested same-origin proxy URLs", () => {
    const inner =
      "https://apptrailers.itunes.apple.com/itunes-assets/variant-low.m3u8";
    const wrapped = `/api/media/apple-preview?url=${encodeURIComponent(inner)}`;
    expect(
      resolveApplePreviewTarget(wrapped, "/api/media/apple-preview"),
    ).toBe(inner);
  });

  it("detects master playlists", () => {
    expect(isMasterPlaylist(MASTER)).toBe(true);
    expect(isMasterPlaylist(VARIANT)).toBe(false);
  });

  it("rewrites master playlist with same-origin relative proxy paths", () => {
    const rewritten = rewritePlaylistForProxy(
      MASTER,
      "https://apptrailers.itunes.apple.com/itunes-assets/master.m3u8",
      "/api/media/apple-preview",
    );
    expect(rewritten).toContain('TYPE=AUDIO');
    expect(rewritten).toContain("/api/media/apple-preview?url=");
    expect(rewritten).not.toContain("http://");
    expect(rewritten).not.toContain("https://audit.test");
  });

  it("rewrites media playlist URIs and segment lines through the proxy", () => {
    const rewritten = rewritePlaylistForProxy(
      VARIANT,
      "https://apptrailers.itunes.apple.com/itunes-assets/variant-low.m3u8",
      "/api/media/apple-preview",
    );
    expect(rewritten).toContain('URI="/api/media/apple-preview?url=');
    expect(rewritten).toContain("segment.mp4");
  });
});
