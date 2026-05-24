"use client";

import { Loader2, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AuditJobStatus } from "@/types/audit";

interface Props {
  status: AuditJobStatus;
}

interface Stage {
  id: AuditJobStatus | "ready";
  label: string;
  description: string;
}

const STAGES: Stage[] = [
  {
    id: "fetching_metadata",
    label: "Looking up the app",
    description: "Fetching metadata from Apple's iTunes API.",
  },
  {
    id: "awaiting_confirmation",
    label: "Confirming app identity",
    description: "Waiting for you to confirm this is the right app.",
  },
  {
    id: "running_audit",
    label: "Running ASO audit",
    description: "Scraping the listing, scoring 10 dimensions, finding competitors, and drafting recommendations.",
  },
  {
    id: "completed",
    label: "Audit complete",
    description: "Your prioritized ASO report is ready.",
  },
];

function stageState(stage: Stage, current: AuditJobStatus): "done" | "active" | "pending" | "failed" {
  if (current === "failed") {
    const order = STAGES.findIndex((s) => s.id === stage.id);
    const currentOrder = STAGES.findIndex(
      (s) => s.id === "running_audit",
    );
    return order <= currentOrder ? "failed" : "pending";
  }
  if (current === "cancelled") return "pending";
  const order = STAGES.findIndex((s) => s.id === stage.id);
  const currentOrder = STAGES.findIndex((s) => s.id === current);
  if (currentOrder === -1) return "pending";
  if (order < currentOrder) return "done";
  if (order === currentOrder) return current === "completed" ? "done" : "active";
  return "pending";
}

export function AuditProgress({ status }: Props) {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Audit in progress</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {STAGES.map((stage) => {
            const state = stageState(stage, status);
            return (
              <li key={stage.id} className="flex items-start gap-1 md:gap-3">
                <div className="mt-0.5 shrink-0">
                  {state === "done" && (
                    <CheckCircle2 className="size-5 text-emerald-500" />
                  )}
                  {state === "active" && (
                    <Loader2 className="size-5 animate-spin text-primary" />
                  )}
                  {state === "pending" && (
                    <Circle className="size-5 text-muted-foreground/40" />
                  )}
                  {state === "failed" && (
                    <AlertCircle className="size-5 text-destructive" />
                  )}
                </div>
                <div>
                  <div
                    className={cn(
                      "text-sm font-medium",
                      state === "pending" && "text-muted-foreground",
                      state === "failed" && "text-destructive",
                    )}
                  >
                    {stage.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{stage.description}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
