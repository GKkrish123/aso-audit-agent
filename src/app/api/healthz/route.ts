import { NextResponse } from "next/server";
import { getMetrics } from "@/lib/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const snapshot = getMetrics().snapshot();
  return NextResponse.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    nodeEnv: process.env.NODE_ENV,
    metrics: snapshot,
  });
}
