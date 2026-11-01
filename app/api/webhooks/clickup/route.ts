import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { get, kvGet, kvSet, logEvent } from "@/lib/db";
import { board, invalidateBoard } from "@/lib/clickup";
import { logStatus, runningTimers, stopTimer } from "@/lib/timers";

// ClickUp pushes task changes here (registered automatically, signed with X-Signature).
// Status changes are stamped with our server time; finishing a task stops its running timer.
export async function POST(req: Request) {
  const raw = await req.text();
  const hook = JSON.parse((await kvGet("clickup_webhook")) ?? "null") as { secret?: string } | null;
  // Only signed calls from our registered webhook are accepted
  if (!hook?.secret) return NextResponse.json({ error: "Webhook not registered" }, { status: 401 });
  const sig = req.headers.get("x-signature") ?? "";
  const want = createHmac("sha256", hook.secret).update(raw).digest("hex");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  await logEvent("clickup", { event: body.event, task_id: body.task_id }).catch(() => {});
  await kvSet("clickup_last_event", String(Date.now())).catch(() => {});
  invalidateBoard();

  if (body.event === "taskStatusUpdated") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (body.history_items ?? []).find((x: any) => x.field === "status") ?? body.history_items?.[0];
    const to = String(h?.after?.status ?? "").toLowerCase();
    // Changes made from the dashboard or by a timer come back from ClickUp too: don't log them twice
    const echo = await get("select 1 from status_log where task_id = ? and to_status = ? and source <> 'clickup' and at > ?", body.task_id, to, Date.now() - 120_000);
    if (to && !echo) {
      const title = (await board().catch(() => null))?.tasks.find((t) => t.id === body.task_id)?.title;
      await logStatus({ taskId: body.task_id, title, person: h?.user?.username, from: h?.before?.status ? String(h.before.status).toLowerCase() : null, to, source: "clickup" });
    }
    // Finishing a task (wherever it was done) stops its running timer
    if (to && (/complete|done|closed/.test(to) || h?.after?.type === "closed" || h?.after?.type === "done")) {
      for (const t of await runningTimers()) if (t.task_id === body.task_id) await stopTimer(t.id);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "ClickUp webhook endpoint" });
}
