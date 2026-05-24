"use client";

import { Sparkles, TrendingUp, Compass, Trophy, AlertCircle, type LucideIcon } from "lucide-react";
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
import {
  DIMENSION_LABELS,
  type AuditReport,
  type DimensionId,
  type Recommendation,
} from "@/types/audit";

interface Props {
  report: AuditReport;
  warnings: string[];
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
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  return (
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
  );
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
      <ul className="space-y-3">
      {filtered.map((r) => (
        <li
          key={r.id}
          className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{DIMENSION_LABELS[r.dimension]}</Badge>
            <span className="min-w-0 wrap-break-word font-medium">{r.title}</span>
          </div>
          <p className="mt-2 wrap-break-word text-muted-foreground">{r.rationale}</p>
          <p className="mt-1 wrap-break-word text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Evidence:</span> {r.evidence}
          </p>
          {(r.before || r.after) && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {r.before && (
                <div className="min-w-0 rounded-md bg-background p-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Before
                  </div>
                  <div className="wrap-break-word font-mono">{r.before}</div>
                </div>
              )}
              {r.after && (
                <div className="min-w-0 rounded-md bg-background p-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    After
                  </div>
                  <div className="wrap-break-word font-mono">{r.after}</div>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AuditResults({ report, warnings }: Props) {
  return (
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
            Per-dimension scores, weighted to a single overall score out of 100.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[auto_1fr]">
          <div className="mx-auto md:mx-0">
            <OverallScore score={report.overallScore} />
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {report.dimensionScores.map((d) => (
              <div key={d.id} className="min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0 truncate font-medium">
                    {DIMENSION_LABELS[d.id as DimensionId]}
                  </div>
                  <div className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                    {d.score.toFixed(1)} / 10
                    <span className="ml-2 text-xs">({d.weight}%)</span>
                  </div>
                </div>
                <ScoreBar value={d.score} />
                <p className="wrap-break-word text-xs text-muted-foreground">{d.summary}</p>
              </div>
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


      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4" />
            Competitor Comparison
          </CardTitle>
          <CardDescription>Top 3 competitors in the same category, by deterministic ranking.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.competitorComparison.length === 0 ? (
            <p className="text-sm text-muted-foreground">No competitor data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Competitor</th>
                    <th className="py-2 pr-3 font-medium">Rating</th>
                    <th className="py-2 pr-3 font-medium">Ratings</th>
                    <th className="py-2 pr-3 font-medium">Overlap</th>
                    <th className="py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.competitorComparison.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{row.competitorName}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {row.rating != null ? row.rating.toFixed(2) : "—"}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {row.ratingCount != null ? row.ratingCount.toLocaleString() : "—"}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {(row.keywordOverlap * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 text-muted-foreground">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-center text-xs text-muted-foreground">
        Powered by Mastra. Scores are computed deterministically and refined with Evidence Backed LLM analysis.
      </p>
    </div>
  );
}
