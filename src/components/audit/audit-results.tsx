"use client";

import * as React from "react";
import {
  Sparkles,
  TrendingUp,
  Compass,
  Trophy,
  AlertCircle,
  ChevronDown,
  Check,
  X,
  Lightbulb,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Minus,
  ExternalLink,
  Star,
  Users,
  Clock,
  Target,
  Type,
  Palette,
  Image as ImageIcon,
  Code2,
  Megaphone,
  Telescope,
  MapPin,
  Play,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AppPreviewVideoPlayer } from "@/components/audit/app-preview-video";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIMENSION_LABELS,
  DIMENSION_WEIGHTS,
  type AppMetadata,
  type AuditMedia,
  type AuditReport,
  type CompetitorComparisonRow,
  type DimensionId,
  type DimensionScore,
  type Recommendation,
  type RecommendationCategory,
  type ScoreComponent,
} from "@/types/audit";

interface Props {
  report: AuditReport;
  warnings: string[];
  metadata?: AppMetadata | null;
  media?: AuditMedia | null;
}

type MediaKind = "icon" | "iphone" | "ipad" | "video";

interface MediaItem {
  kind: MediaKind;
  url: string;
  posterUrl?: string | null;
  label: string;
  index: number;
}

const MEDIA_DIMENSIONS = new Set<DimensionId>([
  "icon",
  "screenshots",
  "appPreviewVideo",
]);

interface MediaGalleryContextValue {
  items: MediaItem[];
  hasGallery: boolean;
  openAt: (index: number) => void;
}

const MediaGalleryContext = React.createContext<MediaGalleryContextValue | null>(
  null,
);

function useMediaGallery(): MediaGalleryContextValue | null {
  return React.useContext(MediaGalleryContext);
}

function flattenMedia(media: AuditMedia): MediaItem[] {
  const items: MediaItem[] = [];
  if (media.iconUrl) {
    items.push({
      kind: "icon",
      url: media.iconUrl,
      label: "App Icon",
      index: 1,
    });
  }
  media.iphoneScreenshots.forEach((url, i) => {
    items.push({
      kind: "iphone",
      url,
      label: `iPhone Screenshot ${i + 1}`,
      index: i + 1,
    });
  });
  media.ipadScreenshots.forEach((url, i) => {
    items.push({
      kind: "ipad",
      url,
      label: `iPad Screenshot ${i + 1}`,
      index: i + 1,
    });
  });
  media.appPreviewVideos.forEach((entry, i) => {
    const url =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry && "url" in entry
          ? String(entry.url)
          : "";
    const posterUrl =
      typeof entry === "object" && entry && "posterUrl" in entry
        ? (entry.posterUrl as string | null | undefined) ?? null
        : null;
    if (!url) return;
    items.push({
      kind: "video",
      url,
      posterUrl,
      label: `App Preview Video ${i + 1}`,
      index: i + 1,
    });
  });
  return items;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function findMediaIndexByUrl(url: string, items: MediaItem[]): number | null {
  const trimmed = url.trim();
  const exact = items.findIndex((item) => item.url === trimmed);
  if (exact >= 0) return exact;
  const fuzzy = items.findIndex(
    (item) => trimmed.startsWith(item.url) || item.url.startsWith(trimmed),
  );
  return fuzzy >= 0 ? fuzzy : null;
}

function getGalleryStartIndexForDimension(
  dimensionId: DimensionId,
  items: MediaItem[],
): number | null {
  switch (dimensionId) {
    case "icon": {
      const i = items.findIndex((item) => item.kind === "icon");
      return i >= 0 ? i : null;
    }
    case "screenshots": {
      const iphone = items.findIndex((item) => item.kind === "iphone");
      if (iphone >= 0) return iphone;
      const ipad = items.findIndex((item) => item.kind === "ipad");
      return ipad >= 0 ? ipad : null;
    }
    case "appPreviewVideo": {
      const video = items.findIndex((item) => item.kind === "video");
      return video >= 0 ? video : null;
    }
    default:
      return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  return text.match(/https?:\/\/[^\s)]+/g) ?? [];
}

function MediaGalleryTrigger({
  index,
  className,
  children,
  title = "Open in gallery",
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  const gallery = useMediaGallery();
  if (!gallery?.hasGallery || index < 0 || index >= gallery.items.length) {
    return <>{children}</>;
  }
  return (
    <button
      type="button"
      title={title}
      onClick={() => gallery.openAt(index)}
      className={cn(
        "group inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
      <Maximize2 className="size-3 shrink-0 opacity-0 transition group-hover:opacity-70" />
    </button>
  );
}

function ObservedValueDisplay({
  value,
  dimensionId,
}: {
  value: string;
  dimensionId: DimensionId;
}) {
  const gallery = useMediaGallery();
  const urlIndex = isHttpUrl(value)
    ? findMediaIndexByUrl(value, gallery?.items ?? [])
    : null;
  const dimensionIndex =
    gallery?.hasGallery && MEDIA_DIMENSIONS.has(dimensionId)
      ? getGalleryStartIndexForDimension(dimensionId, gallery.items)
      : null;
  const galleryIndex = urlIndex ?? dimensionIndex;

  if (galleryIndex === null) {
    return (
      <div className="wrap-break-word mt-0.5 font-mono text-xs leading-snug">
        {value}
      </div>
    );
  }

  const item = gallery!.items[galleryIndex]!;

  return (
    <MediaGalleryTrigger
      index={galleryIndex}
      className="mt-0.5 w-full rounded-sm px-0.5 py-0.5 font-mono text-xs leading-snug hover:bg-primary/5"
      title={`View ${item.label} in gallery`}
    >
      {isHttpUrl(value) ? (
        <span className="flex min-w-0 items-center gap-2">
          {item.kind === "icon" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.url}
              alt=""
              className="size-8 shrink-0 rounded-md border object-cover"
            />
          )}
          <span className="min-w-0 truncate">{value}</span>
        </span>
      ) : (
        <span className="wrap-break-word underline decoration-dotted underline-offset-2">
          {value}
        </span>
      )}
    </MediaGalleryTrigger>
  );
}

function TextWithMediaLinks({ text }: { text: string }) {
  const gallery = useMediaGallery();
  if (!gallery?.hasGallery) {
    return <>{text}</>;
  }

  const urls = extractUrlsFromText(text);
  if (urls.length === 0) {
    return <>{text}</>;
  }

  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!isHttpUrl(part)) return <React.Fragment key={i}>{part}</React.Fragment>;
        const index = findMediaIndexByUrl(part, gallery.items);
        if (index === null) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-primary"
            >
              {part}
            </a>
          );
        }
        return (
          <MediaGalleryTrigger
            key={i}
            index={index}
            className="inline underline decoration-dotted underline-offset-2"
          >
            <span className="wrap-break-word font-mono">{part}</span>
          </MediaGalleryTrigger>
        );
      })}
    </>
  );
}

export const SEVERITY_VISUAL: Record<
  Recommendation["severity"],
  { Icon: LucideIcon; label: string }
> = {
  quickWin: { Icon: Sparkles, label: "Quick win" },
  highImpact: { Icon: TrendingUp, label: "High impact" },
  strategic: { Icon: Compass, label: "Strategic" },
};

function scoreColor(score10: number): string {
  if (score10 >= 8) return "bg-emerald-500";
  if (score10 >= 6) return "bg-amber-500";
  if (score10 >= 4) return "bg-orange-500";
  return "bg-rose-500";
}

function scoreTextColor(score10: number): string {
  if (score10 >= 8) return "text-emerald-600 dark:text-emerald-400";
  if (score10 >= 6) return "text-amber-600 dark:text-amber-400";
  if (score10 >= 4) return "text-orange-600 dark:text-orange-400";
  return "text-rose-600 dark:text-rose-400";
}

function ScoreBar({ value, max = 10 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full transition-all", scoreColor(value))}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function statusFromScore(score10: number): {
  label: string;
  className: string;
} {
  if (score10 >= 8.5)
    return {
      label: "Excellent",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  if (score10 >= 6.5)
    return {
      label: "Good",
      className:
        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  if (score10 >= 4)
    return {
      label: "Needs work",
      className:
        "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    };
  return {
    label: "Critical",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };
}

const CONFIDENCE_LABELS: Record<
  NonNullable<DimensionScore["confidence"]>,
  { label: string; help: string }
> = {
  deterministic: {
    label: "Deterministic",
    help: "Score follows directly from observable facts.",
  },
  heuristic: {
    label: "Heuristic",
    help: "Defensible approximation; some judgement involved.",
  },
  needs_visual_review: {
    label: "Needs visual review",
    help: "A meaningful score requires looking at the asset (icon, screenshots, video).",
  },
};

const SOURCE_LABELS: Record<NonNullable<DimensionScore["source"]>, string> = {
  itunes: "iTunes Lookup API",
  firecrawl: "Firecrawl (markdown)",
  html: "App Store HTML",
  merged: "Merged from multiple sources",
  computed: "Computed (no single source)",
};

function ComponentRow({ c }: { c: ScoreComponent }) {
  const positive = c.contribution >= 0 && c.passed;
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-border/40 py-2 last:border-0">
      <span
        className={cn(
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
          positive
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        )}
        aria-hidden
      >
        {positive ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <div className="min-w-0">
        <div className="wrap-break-word text-sm font-medium">{c.label}</div>
        {c.detail && (
          <div className="wrap-break-word mt-0.5 text-xs text-muted-foreground">
            {isHttpUrl(c.detail) ? (
              <TextWithMediaLinks text={c.detail} />
            ) : (
              c.detail
            )}
          </div>
        )}
      </div>
      <span
        className={cn(
          "shrink-0 self-start whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-xs tabular-nums",
          c.contribution > 0
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : c.contribution < 0
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : "bg-muted text-muted-foreground",
        )}
      >
        {c.contribution > 0 ? "+" : ""}
        {c.contribution.toFixed(1)}
      </span>
    </li>
  );
}

function DimensionCard({ d }: { d: DimensionScore }) {
  const status = statusFromScore(d.score);
  const components = d.components ?? [];
  const confidenceKey = d.confidence ?? "deterministic";
  const confidence = CONFIDENCE_LABELS[confidenceKey];
  const sourceLabel = d.source ? SOURCE_LABELS[d.source] : null;

  return (
    <div className="min-w-0 rounded-lg border bg-card p-4 transition-colors hover:border-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="truncate text-sm font-semibold">
            {DIMENSION_LABELS[d.id as DimensionId]}
          </h4>
          <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
            {d.weight}% weight
          </Badge>
        </div>
        <div className="flex items-baseline gap-1 tabular-nums">
          <span className={cn("font-mono text-lg font-semibold", scoreTextColor(d.score))}>
            {d.score.toFixed(1)}
          </span>
          <span className="text-xs text-muted-foreground">/ 10</span>
        </div>
      </div>

      <div className="mt-2">
        <ScoreBar value={d.score} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn("text-[10px] font-medium", status.className)}
        >
          {status.label}
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px] font-medium text-muted-foreground"
          title={confidence.help}
        >
          {confidence.label}
        </Badge>
        {sourceLabel && (
          <Badge
            variant="outline"
            className="text-[10px] font-medium text-muted-foreground"
            title={`Data source: ${sourceLabel}`}
          >
            src: {sourceLabel}
          </Badge>
        )}
      </div>
      {d.observedValue && (
        <div className="mt-3 rounded-md border border-dashed border-border bg-muted/40 p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Observed
          </div>
          <ObservedValueDisplay value={d.observedValue} dimensionId={d.id} />
        </div>
      )}
      {d.target && (
        <div className="mt-2 flex items-baseline gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Target:</span>
          <span className="wrap-break-word text-foreground">{d.target}</span>
        </div>
      )}
      <p className="wrap-break-word mt-2 text-sm leading-snug text-muted-foreground">
        {d.summary}
      </p>
      {components.length > 0 && (
        <details className="group mt-3 rounded-md border border-border/60">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
            <span>
              Show scoring math
              <span className="ml-1 text-muted-foreground">
                ({components.length} rule{components.length === 1 ? "" : "s"}
                {typeof d.baseline === "number" ? `, baseline ${d.baseline}` : ""})
              </span>
            </span>
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="px-3 pb-2">
            {typeof d.baseline === "number" && (
              <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/40 py-2">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  ·
                </span>
                <span className="text-xs italic text-muted-foreground">
                  Baseline
                </span>
                <span className="shrink-0 whitespace-nowrap rounded-md bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {d.baseline.toFixed(1)}
                </span>
              </li>
            )}
            {components.map((c, i) => (
              <ComponentRow key={i} c={c} />
            ))}
            <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 pt-2 text-xs font-semibold">
              <span aria-hidden />
              <span>Final score</span>
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 font-mono tabular-nums",
                  scoreTextColor(d.score),
                )}
              >
                {d.score.toFixed(1)} / 10
              </span>
            </li>
          </ul>
        </details>
      )}

      {d.improvementHint &&
        d.improvementHint.replace(/[\s.;:!?\-•·]/g, "").length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="wrap-break-word text-xs leading-snug">
              <span className="font-medium text-amber-700 dark:text-amber-300">
                Improve:
              </span>{" "}
              <span className="text-foreground">{d.improvementHint}</span>
            </div>
          </div>
        )}
    </div>
  );
}
function StrengthsWeaknesses({ scores }: { scores: DimensionScore[] }) {
  if (scores.length === 0) return null;
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 2);
  const bottom = [...ranked].reverse().slice(0, 2);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-md border bg-emerald-500/5 p-3">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          Strongest
        </div>
        <ul className="space-y-1 text-sm">
          {top.map((d) => (
            <li key={d.id} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{DIMENSION_LABELS[d.id as DimensionId]}</span>
              <span className={cn("shrink-0 font-mono text-xs tabular-nums", scoreTextColor(d.score))}>
                {d.score.toFixed(1)}/10
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 rounded-md border bg-rose-500/5 p-3">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
          Weakest
        </div>
        <ul className="space-y-1 text-sm">
          {bottom.map((d) => (
            <li key={d.id} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{DIMENSION_LABELS[d.id as DimensionId]}</span>
              <span className={cn("shrink-0 font-mono text-xs tabular-nums", scoreTextColor(d.score))}>
                {d.score.toFixed(1)}/10
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OverallScore({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const ringColor =
    score >= 80
      ? "text-emerald-500"
      : score >= 60
        ? "text-amber-500"
        : score >= 40
          ? "text-orange-500"
          : "text-rose-500";
  const verdict =
    score >= 85
      ? "Excellent"
      : score >= 70
        ? "Strong"
        : score >= 55
          ? "Mixed"
          : score >= 40
            ? "Weak"
            : "Critical";
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex size-32 items-center justify-center">
        <svg className="size-32 -rotate-90" viewBox="0 0 120 120" aria-hidden>
          <circle
            cx="60"
            cy="60"
            r={radius}
            stroke="currentColor"
            strokeWidth="10"
            fill="none"
            className="text-muted/50"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            stroke="currentColor"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            className={cn("transition-all", ringColor)}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <div className="font-heading text-3xl font-semibold">{score}</div>
          <div className="text-xs text-muted-foreground">/ 100</div>
        </div>
      </div>
      <Badge variant="outline" className={cn("text-[10px] font-medium", ringColor)}>
        {verdict}
      </Badge>
    </div>
  );
}

const CATEGORY_VISUAL: Record<
  RecommendationCategory,
  { Icon: LucideIcon; label: string; tone: string }
> = {
  copy: {
    Icon: Type,
    label: "Copy",
    tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  design: {
    Icon: Palette,
    label: "Design",
    tone: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  },
  media: {
    Icon: ImageIcon,
    label: "Media",
    tone: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  engineering: {
    Icon: Code2,
    label: "Engineering",
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  marketing: {
    Icon: Megaphone,
    label: "Marketing",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  strategy: {
    Icon: Telescope,
    label: "Strategy",
    tone: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
};

function formatEffort(effort: NonNullable<Recommendation["effort"]>): string {
  const { unit, estimate } = effort;
  if (estimate === 1) {
    const singular: Record<typeof unit, string> = {
      minutes: "min",
      hours: "hr",
      days: "day",
      sprints: "sprint",
    };
    return `${estimate} ${singular[unit]}`;
  }
  const plural: Record<typeof unit, string> = {
    minutes: "min",
    hours: "hr",
    days: "days",
    sprints: "sprints",
  };
  return `${estimate} ${plural[unit]}`;
}
function totalWeightedImpact(rec: Recommendation): number {
  const items = rec.expectedImpact ?? [];
  const raw = items.reduce(
    (acc, e) =>
      acc + (e.expectedDelta * (DIMENSION_WEIGHTS[e.dimensionId] ?? 0)) / 10,
    0,
  );
  return Math.round(raw * 100) / 100;
}

function RecommendationsList({
  items,
  severity,
}: {
  items: Recommendation[];
  severity: Recommendation["severity"];
}) {
  const filtered = items.filter((r) => r.severity === severity);
  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recommendations in this bucket.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {filtered.map((r, index) => (
        <RecommendationCard
          key={`${severity}-${r.id}-${index}`}
          rec={r}
          index={index + 1}
        />
      ))}
    </ol>
  );
}

function RecommendationCard({
  rec,
  index,
}: {
  rec: Recommendation;
  index: number;
}) {
  const gallery = useMediaGallery();
  const category = rec.category ?? "copy";
  const cat = CATEGORY_VISUAL[category];
  const CatIcon = cat.Icon;
  const overallLift = totalWeightedImpact(rec);
  const hasBeforeAfter = !!(rec.before || rec.after);
  const isTextChange = rec.before !== null && rec.after !== null;
  const mediaGalleryIndex =
    gallery?.hasGallery && MEDIA_DIMENSIONS.has(rec.dimension)
      ? getGalleryStartIndexForDimension(rec.dimension, gallery.items)
      : null;

  return (
    <li className="rounded-lg border bg-card p-3 text-sm leading-relaxed transition hover:border-primary/30">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-muted/40 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide">
              {DIMENSION_LABELS[rec.dimension]}
            </Badge>
            <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide", cat.tone)}>
              <CatIcon className="mr-1 size-3" />
              {cat.label}
            </Badge>
            {rec.effort && (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Clock className="mr-1 size-3" />
                {formatEffort(rec.effort)}
              </Badge>
            )}
            {overallLift > 0 && (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <TrendingUp className="mr-1 size-3" />
                +{overallLift.toFixed(2)} overall
              </Badge>
            )}
          </div>
          <p className="mt-1.5 wrap-break-word font-medium">{rec.title}</p>
        </div>
      </div>
      <p className="mt-2 wrap-break-word text-muted-foreground">{rec.rationale}</p>
      {rec.metric && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/20 px-2.5 py-1.5 text-xs">
          <Target className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-muted-foreground">Current:</span>
          {mediaGalleryIndex !== null ? (
            <MediaGalleryTrigger
              index={mediaGalleryIndex}
              className="wrap-break-word underline decoration-dotted underline-offset-2"
            >
              {rec.metric.current}
            </MediaGalleryTrigger>
          ) : (
            <span className="wrap-break-word">{rec.metric.current}</span>
          )}
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Target:</span>
          <span className="wrap-break-word text-emerald-700 dark:text-emerald-300">{rec.metric.target}</span>
        </div>
      )}
      {rec.expectedImpact && rec.expectedImpact.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Expected lift:
          </span>
          {rec.expectedImpact.map((e, i) => (
            <Badge
              key={i}
              variant="outline"
              className={cn(
                "px-1.5 py-0 text-[10px] font-medium tabular-nums",
                e.expectedDelta > 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : e.expectedDelta < 0
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    : "text-muted-foreground",
              )}
              title={e.note}
            >
              {DIMENSION_LABELS[e.dimensionId]} {e.expectedDelta >= 0 ? "+" : ""}
              {e.expectedDelta.toFixed(2)}
            </Badge>
          ))}
        </div>
      )}
      <p className="mt-2 wrap-break-word text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Evidence:</span>{" "}
        <TextWithMediaLinks text={rec.evidence} />
      </p>
      {rec.location && (
        <p className="mt-1 flex items-start gap-1 wrap-break-word text-xs text-muted-foreground">
          <MapPin className="mt-0.5 size-3 shrink-0" />
          <span>
            <span className="font-medium text-foreground">Apply at:</span>{" "}
            {rec.location}
          </span>
        </p>
      )}
      {hasBeforeAfter && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rec.before && (
            <div className="min-w-0 rounded-md border border-rose-500/20 bg-rose-500/5 p-2 text-xs">
              <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-300">
                <X className="size-3" /> Before
              </div>
              <div className="wrap-break-word font-mono leading-relaxed">{rec.before}</div>
            </div>
          )}
          {rec.after && (
            <div className="min-w-0 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs">
              <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <Check className="size-3" /> After
                {isTextChange && rec.after && (
                  <span className="ml-auto text-[9px] font-medium tabular-nums text-muted-foreground">
                    {rec.after.length} chars
                  </span>
                )}
              </div>
              <div className="wrap-break-word font-mono leading-relaxed">{rec.after}</div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function AuditResults({ report, warnings, metadata, media }: Props) {
  const galleryItems = React.useMemo(
    () => (media ? flattenMedia(media) : []),
    [media],
  );
  const [galleryIndex, setGalleryIndex] = React.useState<number | null>(null);
  const galleryContext = React.useMemo<MediaGalleryContextValue>(
    () => ({
      items: galleryItems,
      hasGallery: galleryItems.length > 0,
      openAt: (index: number) => setGalleryIndex(index),
    }),
    [galleryItems],
  );
  const closeGallery = React.useCallback(() => setGalleryIndex(null), []);
  const handleGalleryIndexChange = React.useCallback(
    (index: number) => setGalleryIndex(index),
    [],
  );

  return (
    <MediaGalleryContext.Provider value={galleryContext}>
    <div className="flex w-full min-w-0 flex-col gap-4">
      {warnings.length > 0 && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Partial-data warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>ASO Score Card</CardTitle>
          <CardDescription>
            Every dimension is graded against an explicit target and backed by
            the observed value, the rules that fired, and the data source.
            Expand &ldquo;Show scoring math&rdquo; on any row to see exactly
            how the score was computed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-[auto_1fr]">
            <div className="mx-auto md:mx-0">
              <OverallScore score={report.overallScore} />
            </div>
            <div className="min-w-0">
              <StrengthsWeaknesses scores={report.dimensionScores} />
            </div>
          </div>

          <Separator />
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {report.dimensionScores.map((d) => (
              <DimensionCard key={d.id} d={d} />
            ))}
          </div>
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Quick Wins
            </CardTitle>
            <CardDescription>Implement today. Low effort, high impact.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecommendationsList items={report.recommendations} severity="quickWin" />
          </CardContent>
        </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4" />
              High-Impact Changes
            </CardTitle>
            <CardDescription>A few hours to days of effort.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecommendationsList items={report.recommendations} severity="highImpact" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Compass className="size-4" />
              Strategic Moves
            </CardTitle>
            <CardDescription>One sprint or more. Often roadmap-level.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecommendationsList items={report.recommendations} severity="strategic" />
          </CardContent>
        </Card>
      </div>

      <CompetitorComparisonSection
        rows={report.competitorComparison}
        metadata={metadata ?? null}
      />

      <Separator />
      <p className="text-center text-xs text-muted-foreground">
        Powered by Mastra. Scores are computed deterministically and refined with Evidence Backed LLM analysis.
      </p>

      {galleryItems.length > 0 && (
        <MediaLightbox
          open={galleryIndex !== null}
          items={galleryItems}
          currentIndex={galleryIndex ?? 0}
          onIndexChange={handleGalleryIndexChange}
          onClose={closeGallery}
          appName={metadata?.trackName ?? "App"}
        />
      )}
    </div>
    </MediaGalleryContext.Provider>
  );
}
const SOURCE_LABEL: Record<NonNullable<CompetitorComparisonRow["source"]>, string> = {
  "top-free-chart": "Top free chart",
  "top-grossing-chart": "Top grossing chart",
  "genre-search": "Genre match",
  "subgenre-search": "Sub-genre match",
  "term-search": "Keyword search",
};

function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function CompetitorComparisonSection({
  rows,
  metadata,
}: {
  rows: CompetitorComparisonRow[];
  metadata: AppMetadata | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="size-4" />
          Competitor Comparison
        </CardTitle>
        <CardDescription>
          {rows.length === 0
            ? "No competitors passed the relevance + popularity filters."
            : `Side-by-side vs. ${rows.length} ${rows.length === 1 ? "peer" : "peers"} ranked by listing similarity. All numbers and deltas are computed deterministically from the iTunes payload — no LLM-generated values.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Alert>
            <AlertCircle className="size-4" />
            <AlertTitle>No competitor data</AlertTitle>
            <AlertDescription>
              The scanner couldn&apos;t identify peer apps with sufficient lexical overlap, rating volume, and category match. Try broadening the listing&apos;s keyword targeting and re-running the audit.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {metadata && <YourAppRow metadata={metadata} />}
            <div className="grid gap-3">
              {rows.map((row) => (
                <CompetitorRow
                  key={row.competitorAppId}
                  row={row}
                  myRating={metadata?.averageUserRating ?? null}
                  myCount={metadata?.userRatingCount ?? null}
                />
              ))}
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              <span className="font-medium">How comparison works:</span> we deduplicate
              candidates from Apple&apos;s top-free / top-grossing charts (genre-filtered),
              iTunes genre / sub-genre / keyword searches, drop same-developer apps
              and listings below 50 ratings, then rank by listing relevance, popularity,
              and chart signal. Deltas use absolute thresholds (≥0.05★ rating, ≥1.5× volume)
              to avoid pill spam on rounding noise.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function YourAppRow({ metadata }: { metadata: AppMetadata }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/15 text-primary border-primary/30 px-2 py-0.5 text-[10px] uppercase tracking-wider">
              Your app
            </Badge>
            <span className="truncate text-sm font-semibold">
              {metadata.trackName}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {metadata.artistName}
            {metadata.primaryGenreName ? ` • ${metadata.primaryGenreName}` : ""}
            {metadata.storefront ? ` • ${metadata.storefront.toUpperCase()}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-right">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Rating
            </p>
            <p className="flex items-center justify-end gap-1 text-sm font-medium tabular-nums">
              <Star className="size-3.5 fill-amber-500 text-amber-500" />
              {metadata.averageUserRating !== null && metadata.averageUserRating !== undefined
                ? metadata.averageUserRating.toFixed(2)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Volume
            </p>
            <p className="flex items-center justify-end gap-1 text-sm font-medium tabular-nums">
              <Users className="size-3.5 text-muted-foreground" />
              {compactNumber(metadata.userRatingCount ?? null)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompetitorRow({
  row,
  myRating,
  myCount,
}: {
  row: CompetitorComparisonRow;
  myRating: number | null;
  myCount: number | null;
}) {
  const sourcePill =
    row.source !== null
      ? row.source === "top-free-chart" || row.source === "top-grossing-chart"
        ? `${SOURCE_LABEL[row.source]}${row.chartRank ? ` #${row.chartRank}` : ""}`
        : SOURCE_LABEL[row.source]
      : null;

  return (
    <div className="rounded-lg border bg-card p-3 transition hover:border-primary/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={row.appStoreUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="group inline-flex items-center gap-1 text-sm font-semibold hover:text-primary"
            >
              <span className="truncate">{row.competitorName}</span>
              <ExternalLink className="size-3.5 opacity-50 transition group-hover:opacity-100" />
            </a>
            {sourcePill && (
              <Badge
                variant="outline"
                className={cn(
                  "px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide",
                  row.source === "top-free-chart" ||
                    row.source === "top-grossing-chart"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-muted-foreground/20 text-muted-foreground",
                )}
              >
                {sourcePill}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {row.developerName}
            {row.category ? ` • ${row.category}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4 text-right">
          <ComparisonStat
            label="Rating"
            value={
              row.rating !== null ? (
                <span className="flex items-center justify-end gap-1 tabular-nums">
                  <Star className="size-3.5 fill-amber-500 text-amber-500" />
                  {row.rating.toFixed(2)}
                </span>
              ) : (
                "—"
              )
            }
            delta={
              row.ratingDelta !== null && myRating !== null ? (
                <DeltaChip
                  value={-row.ratingDelta}
                  format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}★`}
                  threshold={0.05}
                  tooltip={`vs your ${myRating.toFixed(2)}★`}
                />
              ) : null
            }
          />
          <ComparisonStat
            label="Volume"
            value={
              <span className="flex items-center justify-end gap-1 tabular-nums">
                <Users className="size-3.5 text-muted-foreground" />
                {compactNumber(row.ratingCount)}
              </span>
            }
            delta={
              row.ratingCountRatio !== null && myCount !== null ? (
                <RatioChip
                  meRatio={row.ratingCountRatio}
                  tooltip={`vs your ${compactNumber(myCount)}`}
                />
              ) : null
            }
          />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <OverlapBar overlap={row.keywordOverlap} composite={row.compositeSimilarity} />

        {(row.strengths.length > 0 || row.weaknesses.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {row.strengths.map((s, i) => (
              <Badge
                key={`s-${i}`}
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <ArrowUp className="mr-0.5 size-3" /> {s}
              </Badge>
            ))}
            {row.weaknesses.map((w, i) => (
              <Badge
                key={`w-${i}`}
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                <ArrowDown className="mr-0.5 size-3" /> {w}
              </Badge>
            ))}
          </div>
        )}

        {row.notes && (
          <p className="text-xs text-muted-foreground">
            {row.notes}
          </p>
        )}
      </div>
    </div>
  );
}

function ComparisonStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  delta: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium">{value}</p>
      {delta && <div className="mt-0.5 flex justify-end">{delta}</div>}
    </div>
  );
}
function DeltaChip({
  value,
  format,
  threshold,
  tooltip,
}: {
  value: number;
  format: (v: number) => string;
  threshold: number;
  tooltip?: string;
}) {
  const isParity = Math.abs(value) < threshold;
  const Icon = isParity ? Minus : value > 0 ? ArrowUp : ArrowDown;
  const tone = isParity
    ? "text-muted-foreground"
    : value > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
        tone,
      )}
      title={tooltip}
    >
      <Icon className="size-3" />
      {format(value)}
    </span>
  );
}
function RatioChip({ meRatio, tooltip }: { meRatio: number; tooltip?: string }) {
  if (meRatio >= 1.5) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
        title={tooltip}
      >
        <ArrowUp className="size-3" />
        {meRatio.toFixed(2)}× larger
      </span>
    );
  }
  if (meRatio > 0 && meRatio <= 1 / 1.5) {
    const flipped = 1 / meRatio;
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums text-rose-600 dark:text-rose-400"
        title={tooltip}
      >
        <ArrowDown className="size-3" />
        {flipped.toFixed(2)}× smaller
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground"
      title={tooltip}
    >
      <Minus className="size-3" />
      ≈ same volume
    </span>
  );
}

function OverlapBar({
  overlap,
  composite,
}: {
  overlap: number;
  composite: number | null;
}) {
  const overlapPct = Math.max(0, Math.min(100, overlap * 100));
  const compositePct =
    composite !== null ? Math.max(0, Math.min(100, composite * 100)) : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{overlapPct.toFixed(0)}%</span>{" "}
          keyword overlap
          {compositePct !== null && (
            <>
              {" "}
              •{" "}
              <span className="font-medium text-foreground">
                {compositePct.toFixed(0)}%
              </span>{" "}
              similarity
            </>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary/70 transition-all"
          style={{ width: `${overlapPct}%` }}
        />
      </div>
    </div>
  );
}
function MediaLightbox({
  open,
  items,
  currentIndex,
  onIndexChange,
  onClose,
  appName,
}: {
  open: boolean;
  items: MediaItem[];
  currentIndex: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  appName: string;
}) {
  const next = React.useCallback(() => {
    if (items.length === 0) return;
    onIndexChange((currentIndex + 1) % items.length);
  }, [items.length, currentIndex, onIndexChange]);

  const prev = React.useCallback(() => {
    if (items.length === 0) return;
    onIndexChange((currentIndex - 1 + items.length) % items.length);
  }, [items.length, currentIndex, onIndexChange]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev]);

  const item = items[currentIndex];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle className="sr-only">
          {appName} — {item?.label ?? "Media"}
        </DialogTitle>

        {item && (
          <div className="relative flex h-full w-full max-w-6xl flex-col items-center justify-center gap-3">
            <div className="flex w-full items-center justify-between gap-3 px-2 text-white">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-white/30 bg-white/10 px-1.5 py-0 text-[10px] uppercase tracking-wider text-white"
                >
                  {item.kind === "icon"
                    ? "App icon"
                    : item.kind === "iphone"
                      ? "iPhone"
                      : item.kind === "ipad"
                        ? "iPad"
                        : "Video"}
                </Badge>
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-xs text-white/60 tabular-nums">
                  {currentIndex + 1} / {items.length}
                </span>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
              >
                <ExternalLink className="size-3" />
                Open original
              </a>
            </div>
            <div className="relative flex max-h-[80vh] w-full flex-1 items-center justify-center">
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Previous"
                  className="absolute left-0 z-10 inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white/40 md:-left-12"
                >
                  <ChevronLeft className="size-5" />
                </button>
              )}

              {item.kind === "video" ? (
                <AppPreviewVideoPlayer
                  key={`${item.url}-${open}`}
                  src={item.url}
                  poster={item.posterUrl}
                  active={open}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={item.url}
                  src={item.url}
                  alt={item.label}
                  className={cn(
                    "max-h-[80vh] max-w-full rounded-md bg-black object-contain",
                    item.kind === "icon" && "rounded-2xl",
                  )}
                />
              )}

              {items.length > 1 && (
                <button
                  type="button"
                  onClick={next}
                  aria-label="Next"
                  className="absolute right-0 z-10 inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white/40 md:-right-12"
                >
                  <ChevronRight className="size-5" />
                </button>
              )}
            </div>
            {items.length > 1 && (
              <div className="flex w-full max-w-full justify-center gap-1.5 overflow-x-auto px-2 py-1">
                {items.map((it, i) => (
                  <button
                    key={`thumb-${i}`}
                    type="button"
                    onClick={() => onIndexChange(i)}
                    aria-label={`Jump to ${it.label}`}
                    className={cn(
                      "shrink-0 overflow-hidden rounded-sm border-2 transition",
                      i === currentIndex
                        ? "border-white"
                        : "border-transparent opacity-60 hover:opacity-100",
                    )}
                    style={{ width: 36, height: 56 }}
                  >
                    {it.kind === "video" ? (
                      it.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={it.posterUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-black">
                          <Play className="size-3 fill-white text-white" />
                        </div>
                      )
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
