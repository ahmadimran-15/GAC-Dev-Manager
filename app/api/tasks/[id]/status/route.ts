import { NextResponse } from "next/server";
import { board, setTaskStatus, taskStatuses } from "@/lib/clickup";
import { logStatus, runningTimers, statusHistory, stopTimer, syncStatusTimers } from "@/lib/timers";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// The statuses this task can move to, plus its change history (stamped by our clock).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [s, history] = await Promise.all([taskStatuses(id), statusHistory(id)]);
    return NextResponse.json({ ...s, history });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 500 });
  }
}

// Change the status from the dashboard; it's written to ClickUp straight away.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = String((await req.json().catch(() => ({}))).status ?? "").trim().toLowerCase();
  if (!status) return NextResponse.json({ error: "Pick a status" }, { status: 400 });
  try {
    const s = await taskStatuses(id);
    if (!s.options.some((o) => o.status === status)) return NextResponse.json({ error: `"${status}" isn't a status in this list` }, { status: 400 });
    if (s.current === status) return NextResponse.json({ ok: true, unchanged: true });
    await setTaskStatus(id, status);
    const me = await currentUser();
    await logStatus({ taskId: id, title: s.title, person: me?.name ?? "Owner", from: s.current, to: status, source: "dashboard" });
    const type = s.options.find((o) => o.status === status)?.type;
    if (type === "closed" || type === "done" || /complete|done|closed/.test(status)) {
      for (const t of await runningTimers()) if (t.task_id === id) await stopTimer(t.id);
    }
    // The timer follows the new status (in progress / revision runs, anything else pauses)
    await syncStatusTimers((await board(true)).tasks).catch(() => {});
    return NextResponse.json({ ok: true, from: s.current, to: status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 500 });
  }
}
