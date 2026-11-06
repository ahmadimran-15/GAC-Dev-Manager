import { NextResponse } from "next/server";
import { getConversation, getDraft, setDraftStatus } from "@/lib/store";
import { sendToConversation, sendToTarget } from "@/lib/inbound";
import { setTaskStatus, taskStatuses } from "@/lib/clickup";
import { logStatus } from "@/lib/timers";
import { currentUser } from "@/lib/auth";

// Moves the ClickUp task behind a task thread. Anything that goes wrong here is reported but never
// fails the approval: the comment has already been posted and must not look unsent.
async function moveTask(convId: string, want: string, author: string) {
  try {
    const conv = await getConversation(convId);
    if (!conv || conv.channel !== "clickup" || !conv.external_id) return { ok: false, error: "not a ClickUp task" };
    const s = await taskStatuses(conv.external_id);
    if (!s.options.some((o) => o.status === want)) return { ok: false, error: `"${want}" isn't a status in this list` };
    if (s.current === want) return { ok: true, unchanged: true, to: want };
    await setTaskStatus(conv.external_id, want);
    const me = await currentUser();
    await logStatus({ taskId: conv.external_id, title: s.title, person: me?.name ?? author, from: s.current, to: want, source: "dashboard" });
    return { ok: true, from: s.current, to: want };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "status change failed" };
  }
}

// Approve (send from your account) or discard a teammate's update.
// Either reply in the client's conversation, or pick any recipient: WhatsApp group/contact or email.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, text, conv_id, from, target, taskStatus } = await req.json().catch(() => ({}));
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
    // The comment is posted; now move the task if a status was asked for or chosen here. The owner's
    // choice wins over the teammate's request, so an update that reads badly can go to revision
    // instead of the "waiting for approval" they asked for.
    const wanted = String(taskStatus ?? d.task_status ?? "").trim().toLowerCase();
    const moved = wanted ? await moveTask(conv, wanted, d.author) : null;
    return NextResponse.json({ ...r, status: moved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
