import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmAuditJob } from "@/lib/jobs/audit-job-store";
import { withCorrelation } from "@/lib/observability/logger";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({ confirmed: z.boolean() });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const correlationId = nanoid(10);
  const logger = withCorrelation(correlationId);
  const { jobId } = await ctx.params;

  let body: { confirmed: boolean };
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const job = await confirmAuditJob(jobId, body.confirmed);
    logger.info({ jobId, confirmed: body.confirmed }, "confirmation submitted");
    return NextResponse.json({ job });
  } catch (err) {
    logger.error({ jobId, err: (err as Error).message }, "confirm failed");
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
