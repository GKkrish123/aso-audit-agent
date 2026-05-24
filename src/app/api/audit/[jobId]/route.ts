import { NextResponse } from "next/server";
import { getAuditJob } from "@/lib/jobs/audit-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await ctx.params;
  try {
    const job = await getAuditJob(jobId);
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 404 },
    );
  }
}
