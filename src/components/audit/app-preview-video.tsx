"use client";

import * as React from "react";
import Hls from "hls.js";
import { ExternalLink, Loader2, Play } from "lucide-react";

import { buildProxyPlaybackUrl } from "@/lib/media/apple-preview-proxy";
import { cn } from "@/lib/utils";

function isHlsStream(url: string): boolean {
  return /\.m3u8(?:\?|$)/i.test(url);
}

function isSafariWithNativeHls(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isSafari =
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|Edg|OPR|Firefox|FxiOS|SamsungBrowser/i.test(ua);
  if (!isSafari) return false;
  return (
    document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !==
    ""
  );
}

interface Props {
  src: string;
  poster?: string | null;
  className?: string;
  active?: boolean;
}

function VideoFallback({
  src,
  poster,
  message,
}: {
  src: string;
  poster?: string | null;
  message: string;
}) {
  return (
    <div className="relative flex max-h-[80vh] max-w-full flex-col items-center justify-center gap-3 rounded-md bg-black p-4">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt="App preview poster"
          className="max-h-[60vh] max-w-full rounded-md object-contain"
        />
      ) : (
        <div className="flex size-24 items-center justify-center rounded-full bg-white/10">
          <Play className="size-10 fill-white text-white" />
        </div>
      )}
      <p className="max-w-md text-center text-sm text-white/80">{message}</p>
      <a
        href={src}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
      >
        <ExternalLink className="size-3" />
        Open stream URL
      </a>
    </div>
  );
}

export function AppPreviewVideoPlayer({
  src,
  poster,
  className,
  active = true,
}: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const hlsRef = React.useRef<Hls | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  const useNativeHls = React.useMemo(
    () => isHlsStream(src) && isSafariWithNativeHls(),
    [src],
  );

  React.useEffect(() => {
    if (!active || !src) return;

    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;
    let innerCleanup: (() => void) | undefined;

    const markReady = () => {
      if (!destroyed) setStatus("ready");
    };
    const markError = () => {
      if (!destroyed) setStatus("error");
    };

    const destroyHls = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };

    const attachHls = (streamUrl: string, allowProxyFallback: boolean) => {
      destroyHls();
      let networkRetries = 0;

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        startLevel: -1,
        capLevelToPlayerSize: true,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, markReady);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || destroyed) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 2) {
          networkRetries += 1;
          hls.startLoad();
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        if (allowProxyFallback && streamUrl === src) {
          innerCleanup = attachHls(buildProxyPlaybackUrl(src), false);
          return;
        }

        markError();
      });

      return () => destroyHls();
    };

    if (useNativeHls || !Hls.isSupported()) {
      video.src = src;
      const onReady = () => markReady();
      const onErr = () => markError();
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("error", onErr);
      innerCleanup = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onErr);
      };
    } else {
      innerCleanup = attachHls(src, true);
    }

    return () => {
      destroyed = true;
      innerCleanup?.();
      destroyHls();
      video.removeAttribute("src");
      video.load();
    };
  }, [active, src, useNativeHls]);

  if (!src) {
    return (
      <VideoFallback
        src=""
        poster={poster}
        message="No app preview stream URL was captured for this listing."
      />
    );
  }

  if (!active) {
    return (
      <div className="flex max-h-[80vh] min-h-[200px] items-center justify-center rounded-md bg-black">
        <Loader2 className="size-8 animate-spin text-white/60" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <VideoFallback
        src={src}
        poster={poster}
        message="This app preview couldn't be played in your browser."
      />
    );
  }

  return (
    <div className="relative">
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-black/60">
          <Loader2 className="size-8 animate-spin text-white" />
        </div>
      )}
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        controls
        playsInline
        preload="auto"
        className={cn("max-h-[80vh] max-w-full rounded-md bg-black", className)}
      />
    </div>
  );
}
