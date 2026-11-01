import { NextResponse } from "next/server";
import { getConversation, getMessages, summarize, updateConversation } from "@/lib/store";
import { all } from "@/lib/db";
import { sendToConversation } from "@/lib/inbound";
import { suggestReply } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getConversation(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [summary, messages, drafts] = await Promise.all([summarize(id), getMessages(id), all("select * from drafts where conv_id = ? and status = 'pending' order by created_at", id)]);
  return NextResponse.json({ conversation: { ...summary, subject: c.subject }, messages, drafts });
}

// Actions on one conversation: send, mark handled/open, set project, redo the suggestion.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "send": {
        if (!String(body.text ?? "").trim()) return NextResponse.json({ error: "Empty message" }, { status: 400 });
        return NextResponse.json(await sendToConversation(id, String(body.text).trim(), { ack: !!body.ack, from: body.from || null }));
      }
      case "handled":
        await updateConversation(id, { status: "handled" });
        return NextResponse.json({ ok: true });
      case "reopen":
        await updateConversation(id, { status: "open" });
        return NextResponse.json({ ok: true });
      case "project":
        await updateConversation(id, { project: body.project || null });
        return NextResponse.json({ ok: true });
      case "suggest":
        return NextResponse.json({ suggestion: await suggestReply(id) });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
