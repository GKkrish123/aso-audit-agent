import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ChatNotFoundError,
  OneAuditPerChatError,
  createAuditJob,
} from "@/lib/jobs/audit-job-store";
import { withCorrelation } from "@/lib/observability/logger";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/security/rate-limit";
import { InvalidAppStoreUrlError, parseAppStoreUrl } from "@/lib/security/url-guard";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({ url: z.string().min(1), chatId: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  const correlationId = nanoid(10);
  const logger = withCorrelation(correlationId);

  const limit = consumeRateLimit(`POST /api/audit:${clientKeyFromRequest(req)}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfterMs: limit.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: { url: string; chatId: string };
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    parseAppStoreUrl(body.url);
  } catch (err) {
    if (err instanceof InvalidAppStoreUrlError) {
      return NextResponse.json(
        { error: err.message, reason: err.reason },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const job = await createAuditJob({ url: body.url, chatId: body.chatId });
    logger.info(
      { jobId: job.jobId, chatId: body.chatId, status: job.status },
      "audit job created",
    );
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (err instanceof ChatNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof OneAuditPerChatError) {
      return NextResponse.json(
        { error: "This chat already contains an audit", jobId: err.existingJobId },
        { status: 409 },
      );
    }
    logger.error({ err: (err as Error).message }, "audit job creation failed");
    return NextResponse.json(
      { error: "Failed to create audit job. Please try again." },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true });
}
