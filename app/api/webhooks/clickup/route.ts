import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { kvGet, kvSet, logEvent } from "@/lib/db";
import { invalidateBoard } from "@/lib/clickup";
import { logStatus, runningTimers, stopTimer } from "@/lib/timers";

// ClickUp pushes task changes here (registered automatically, signed with X-Signature).
// Status changes are stamped with our server time; finishing a task stops its running timer.
export async function POST(req: Request) {
  const raw = await req.text();
  const hook = JSON.parse((await kvGet("clickup_webhook")) ?? "null") as { secret?: string } | null;
  if (hook?.secret) {
    const sig = req.headers.get("x-signature") ?? "";
    const want = createHmac("sha256", hook.secret).update(raw).digest("hex");
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
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
    if (to) {
      await logStatus({ taskId: body.task_id, person: h?.user?.username, from: h?.before?.status ? String(h.before.status).toLowerCase() : null, to, source: "clickup" });
      if (/complete|done|closed/.test(to) || h?.after?.type === "closed" || h?.after?.type === "done") {
        for (const t of await runningTimers()) if (t.task_id === body.task_id) await stopTimer(t.id);
      }
    }
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "ClickUp webhook endpoint" });
}
