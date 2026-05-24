import { NextResponse } from "next/server";
import {
  InvalidChatCursorError,
  createChatSession,
  listChatSessions,
} from "@/lib/jobs/audit-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const archivedOnly = url.searchParams.get("archivedOnly") === "true";
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const limit = parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
  try {
    const { chats, nextCursor } = await listChatSessions({
      limit,
      cursor,
      includeArchived,
      archivedOnly,
    });
    return NextResponse.json({ chats, nextCursor });
  } catch (err) {
    console.error("Error loading chats", err);
    if (err instanceof InvalidChatCursorError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load chats" }, { status: 500 });
  }
}

export async function POST(): Promise<Response> {
  const result = await createChatSession();
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
