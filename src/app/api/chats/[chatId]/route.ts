import { NextResponse } from "next/server";
import {
  ChatHasActiveAuditError,
  ChatNotFoundError,
  archiveChatSession,
  deleteChatSession,
  getChatSession,
  restoreChatSession,
} from "@/lib/jobs/audit-job-store";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({
  action: z.enum(["archive", "restore"]),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ chatId: string }> },
): Promise<Response> {
  const { chatId } = await ctx.params;
  try {
    const chat = await getChatSession(chatId);
    return NextResponse.json({ chat });
  } catch (err) {
    if (err instanceof ChatNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to load chat" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ chatId: string }> },
): Promise<Response> {
  const { chatId } = await ctx.params;
  let body: { action: "archive" | "restore" };
  try {
    body = PatchBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  try {
    const chat =
      body.action === "archive"
        ? await archiveChatSession(chatId)
        : await restoreChatSession(chatId);
    return NextResponse.json({ chat });
  } catch (err) {
    if (err instanceof ChatNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ChatHasActiveAuditError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update chat" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ chatId: string }> },
): Promise<Response> {
  const { chatId } = await ctx.params;
  try {
    await deleteChatSession(chatId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof ChatNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ChatHasActiveAuditError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to delete chat" }, { status: 500 });
  }
}
