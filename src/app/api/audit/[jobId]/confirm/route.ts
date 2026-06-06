import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmAuditJob, WorkflowNotSuspendedError } from "@/lib/jobs/audit-job-store";
import { withCorrelation } from "@/lib/observability/logger";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({ confirmed: z.boolean() });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const correlationId = nanoid(10);
  const logger = withCorrelation(correlationId);
  const { jobId } = await ctx.params;
  const startedAt = performance.now();

  let body: { confirmed: boolean };
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  logger.info(
    { jobId, confirmed: body.confirmed, hop: "route.confirm", phase: "start" },
    "\u25b6 POST /api/audit/:jobId/confirm",
  );

  try {
    const job = await confirmAuditJob(jobId, body.confirmed);
    const durationMs = Math.round(performance.now() - startedAt);
    logger.info(
      {
        jobId,
        confirmed: body.confirmed,
        hop: "route.confirm",
        phase: "end",
        ok: true,
        durationMs,
        jobStatus: job?.status ?? "released",
      },
      `\u2713 POST /api/audit/:jobId/confirm (${durationMs}ms)`,
    );
    return NextResponse.json({ job });
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    logger.error(
      {
        jobId,
        confirmed: body.confirmed,
        hop: "route.confirm",
        phase: "end",
        ok: false,
        durationMs,
        err: (err as Error).message,
      },
      "\u2717 confirm failed",
    );
    if (err instanceof WorkflowNotSuspendedError) {
      return NextResponse.json(
        {
          error: err.message,
          reason: "workflow_not_suspended",
          snapshotStatus: err.snapshotStatus,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
