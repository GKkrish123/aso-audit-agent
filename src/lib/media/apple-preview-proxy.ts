const ALLOWED_HOST = "apptrailers.itunes.apple.com";

export function isAllowedApplePreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === ALLOWED_HOST && parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveApplePreviewTarget(
  rawUrl: string,
  requestPathname: string,
): string | null {
  let target = rawUrl;
  try {
    target = decodeURIComponent(rawUrl);
  } catch {
    return null;
  }

  if (isAllowedApplePreviewUrl(target)) return target;

  try {
    const parsed = new URL(target, "http://local");
    if (parsed.pathname === requestPathname) {
      const inner = parsed.searchParams.get("url");
      if (inner && isAllowedApplePreviewUrl(inner)) return inner;
    }
  } catch {}

  return null;
}

export function isM3u8Playlist(url: string, contentType?: string | null): boolean {
  if (/\.m3u8(?:\?|$)/i.test(url)) return true;
  return !!contentType?.includes("mpegurl") || !!contentType?.includes("m3u8");
}

export function isMasterPlaylist(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF:");
}

function toAbsoluteUri(uri: string, playlistUrl: string): string {
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  const base = playlistUrl.slice(0, playlistUrl.lastIndexOf("/") + 1);
  return `${base}${uri}`;
}

export function rewritePlaylistForProxy(
  playlistText: string,
  playlistUrl: string,
  proxyPath: string,
): string {
  const base = playlistUrl.slice(0, playlistUrl.lastIndexOf("/") + 1);

  const wrap = (absoluteUrl: string): string =>
    `${proxyPath}?url=${encodeURIComponent(absoluteUrl)}`;

  return playlistText
    .split("\n")
    .map((line) => {
      if (line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          const absolute = toAbsoluteUri(uri, playlistUrl);
          return `URI="${wrap(absolute)}"`;
        });
      }

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;

      const absolute = trimmed.startsWith("http") ? trimmed : `${base}${trimmed}`;
      return wrap(absolute);
    })
    .join("\n");
}

export function buildProxyPlaybackUrl(src: string): string {
  return `/api/media/apple-preview?url=${encodeURIComponent(src)}`;
}
