import { NextResponse } from "next/server";
import { getDraft, setDraftStatus } from "@/lib/store";
import { sendToConversation } from "@/lib/inbound";

// Approve (send from your account) or discard a teammate's draft.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, text, conv_id } = await req.json().catch(() => ({}));
  const d = getDraft(id);
  if (!d || d.status !== "pending") return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (action === "discard") {
    setDraftStatus(id, "discarded");
    return NextResponse.json({ ok: true });
  }
  const target = conv_id || d.conv_id;
  if (!target) return NextResponse.json({ error: "Pick which client this goes to" }, { status: 400 });
  try {
    const r = await sendToConversation(target, String(text || d.text).trim(), { by: d.author });
    setDraftStatus(id, "approved");
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 502 });
  }
}
