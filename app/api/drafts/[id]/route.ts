import { NextResponse } from "next/server";
import { getDraft, setDraftStatus } from "@/lib/store";
import { sendToConversation, sendToTarget } from "@/lib/inbound";

// Approve (send from your account) or discard a teammate's update.
// Either reply in the client's conversation, or pick any recipient: WhatsApp group/contact or email.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, text, conv_id, from, target } = await req.json().catch(() => ({}));
  const d = await getDraft(id);
  if (!d || d.status !== "pending") return NextResponse.json({ error: "This update was already handled" }, { status: 404 });
  if (action === "discard") {
    await setDraftStatus(id, "discarded");
    return NextResponse.json({ ok: true });
  }
  const body = String(text || d.text).trim();
  try {
    if (target?.to) {
      const r = await sendToTarget({ channel: target.channel, from: target.from, to: target.to, toName: target.toName, subject: target.subject, text: body, by: d.author });
      await setDraftStatus(id, "approved", target.toName || target.to);
      return NextResponse.json(r);
    }
    const conv = conv_id || d.conv_id;
    if (!conv) return NextResponse.json({ error: "Pick who this goes to" }, { status: 400 });
    const r = await sendToConversation(conv, body, { by: d.author, from: from || null });
    await setDraftStatus(id, "approved", r.name);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
