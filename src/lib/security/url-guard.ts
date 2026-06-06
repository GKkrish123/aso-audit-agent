
const STOREFRONT_RE = /^[a-z]{2}$/i;
const APP_ID_RE = /^id(\d{4,15})$/i;
const HOST_ALLOWLIST = new Set([
  "apps.apple.com",
  "itunes.apple.com",
  "www.apps.apple.com",
]);

export interface ParsedAppStoreUrl {
  appId: string;
  storefront: string;
  slug?: string;
  canonicalUrl: string;
}

export class InvalidAppStoreUrlError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "not_a_url"
      | "wrong_host"
      | "no_app_id"
      | "bad_storefront",
  ) {
    super(message);
    this.name = "InvalidAppStoreUrlError";
  }
}

export function parseAppStoreUrl(raw: string): ParsedAppStoreUrl {
  if (typeof raw !== "string") {
    throw new InvalidAppStoreUrlError("URL must be a string", "not_a_url");
  }

  let candidate = raw.trim();
  if (!candidate) {
    throw new InvalidAppStoreUrlError("URL is empty", "not_a_url");
  }

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new InvalidAppStoreUrlError(
      `Could not parse as a URL: ${raw}`,
      "not_a_url",
    );
  }

  if (!HOST_ALLOWLIST.has(url.hostname.toLowerCase())) {
    throw new InvalidAppStoreUrlError(
      `Only Apple App Store URLs are supported (got ${url.hostname}).`,
      "wrong_host",
    );
  }

  const segments = url.pathname
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  let storefront = "us";
  let slug: string | undefined;
  let appIdSegment: string | undefined;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === 0 && STOREFRONT_RE.test(seg)) {
      storefront = seg.toLowerCase();
      continue;
    }
    if (seg === "app") {
      const next = segments[i + 1];
      const after = segments[i + 2];
      if (next && APP_ID_RE.test(next)) {
        appIdSegment = next;
      } else if (next) {
        slug = next;
        if (after && APP_ID_RE.test(after)) appIdSegment = after;
      }
      break;
    }
    if (APP_ID_RE.test(seg)) {
      appIdSegment = seg;
    }
  }

  if (!appIdSegment) {
    throw new InvalidAppStoreUrlError(
      "URL does not contain an App Store id (expected e.g. `idXXXXXXXXX`).",
      "no_app_id",
    );
  }

  const appId = APP_ID_RE.exec(appIdSegment)![1];

  const canonicalUrl = `https://apps.apple.com/${storefront}/app/${
    slug ? `${slug}/` : ""
  }id${appId}`;

  return { appId, storefront, slug, canonicalUrl };
}

export function isLikelyAppStoreUrl(raw: string): boolean {
  try {
    parseAppStoreUrl(raw);
    return true;
  } catch {
    return false;
  }
}
