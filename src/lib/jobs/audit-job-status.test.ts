import { describe, expect, it } from "vitest";
import { resolveAuditJobStatus } from "@/lib/jobs/audit-job-status";

describe("resolveAuditJobStatus", () => {
  it("returns running_audit after confirm while snapshot lags", () => {
    expect(resolveAuditJobStatus("awaiting_confirmation", Date.now())).toBe(
      "running_audit",
    );
  });

  it("does not override terminal statuses", () => {
    expect(resolveAuditJobStatus("completed", Date.now())).toBe("completed");
    expect(resolveAuditJobStatus("failed", Date.now())).toBe("failed");
  });

  it("passes through when not yet confirmed", () => {
    expect(resolveAuditJobStatus("awaiting_confirmation", null)).toBe(
      "awaiting_confirmation",
    );
  });
});
