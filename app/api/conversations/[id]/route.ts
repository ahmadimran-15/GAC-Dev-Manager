import { NextResponse } from "next/server";
import { getConversation, getMessages, summarize, updateConversation } from "@/lib/store";
import { all } from "@/lib/db";
import { sendToConversation } from "@/lib/inbound";
import { generateReply, suggestReply, summarizeConversation } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getConversation(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [summary, messages, drafts, links] = await Promise.all([
    summarize(id),
    getMessages(id),
    all("select * from drafts where conv_id = ? and status = 'pending' order by created_at", id),
    all<{ task_id: string; title: string; url: string | null; project: string | null; message_ids: string | null; created_at: number }>(
      "select task_id, title, url, project, message_ids, created_at from task_links where conv_id = ? order by created_at desc",
      id,
    ),
  ]);
  return NextResponse.json({
    conversation: { ...summary, subject: c.subject },
    messages,
    drafts,
    links: links.map((l) => ({ ...l, created_at: Number(l.created_at), message_ids: JSON.parse(l.message_ids || "[]") as string[] })),
  });
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
      case "remind_after": {
        // Minutes this client may wait before reminders start; null = your default
        const m = body.minutes === null || body.minutes === "" ? null : Math.round(Number(body.minutes));
        if (m !== null && (!Number.isFinite(m) || m < 1 || m > 1440)) return NextResponse.json({ error: "Pick 1–1440 minutes" }, { status: 400 });
        await updateConversation(id, { remind_after: m });
        return NextResponse.json({ ok: true });
      }
      case "internal":
        // "Not a client": personal or team chats stay in the inbox but never wait or remind
        await updateConversation(id, { internal: body.value ? 1 : 0 });
        return NextResponse.json({ ok: true });
      case "generate":
        return NextResponse.json({ text: await generateReply(id, String(body.input ?? "")) });
      case "context":
        return NextResponse.json({ context: await summarizeConversation(id) });
      case "suggest":
        return NextResponse.json({ suggestion: await suggestReply(id) });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
