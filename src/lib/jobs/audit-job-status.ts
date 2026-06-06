import type { AuditJobStatus } from "@/types/audit";

function isTerminalAuditStatus(status: AuditJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function resolveAuditJobStatus(
  inferred: AuditJobStatus,
  confirmedAt: number | null,
): AuditJobStatus {
  if (confirmedAt == null || isTerminalAuditStatus(inferred)) return inferred;
  if (
    inferred === "awaiting_confirmation" ||
    inferred === "queued" ||
    inferred === "fetching_metadata"
  ) {
    return "running_audit";
  }
  return inferred;
}
