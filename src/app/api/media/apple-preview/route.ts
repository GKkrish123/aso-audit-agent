import { NextRequest, NextResponse } from "next/server";

import {
  isM3u8Playlist,
  resolveApplePreviewTarget,
  rewritePlaylistForProxy,
} from "@/lib/media/apple-preview-proxy";

export const runtime = "nodejs";

const PROXY_PATH = "/api/media/apple-preview";

async function fetchUpstream(url: string, req: NextRequest): Promise<Response> {
  const range = req.headers.get("range");
  return fetch(url, {
    headers: range ? { Range: range } : undefined,
    cache: "no-store",
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const targetUrl = resolveApplePreviewTarget(rawUrl, PROXY_PATH);
  if (!targetUrl) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 403 });
  }

  const upstream = await fetchUpstream(targetUrl, req);
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Upstream fetch failed (${upstream.status})` },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const contentType = upstream.headers.get("content-type");

  if (isM3u8Playlist(targetUrl, contentType)) {
    const text = await upstream.text();
    const rewritten = rewritePlaylistForProxy(text, targetUrl, PROXY_PATH);
    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  const headers = new Headers();
  const passThrough = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
  ] as const;
  for (const key of passThrough) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("Cache-Control", "private, max-age=3600");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
