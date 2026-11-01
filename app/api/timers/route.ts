import { NextResponse } from "next/server";
import { board } from "@/lib/clickup";
import { currentUser } from "@/lib/auth";
import { minutesByTask, runningTimers, setTimersEnabled, startTimer, stopTimer, timersForTask } from "@/lib/timers";

export const dynamic = "force-dynamic";

// Owner view: who is working on what right now, and tracked minutes per task.
export async function GET(req: Request) {
  const task = new URL(req.url).searchParams.get("task");
  if (task) return NextResponse.json({ now: Date.now(), entries: await timersForTask(task) });
  const [running, tracked] = await Promise.all([runningTimers(), minutesByTask()]);
  return NextResponse.json({ now: Date.now(), running, tracked });
}

// {action:"start", taskId, person?} (person defaults to the task's assignee) · {action:"stop", id}
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const me = await currentUser();
  if (b.action === "enabled") {
    await setTimersEnabled(!!b.on);
    return NextResponse.json({ ok: true, on: !!b.on });
  }
  if (b.action === "stop") {
    const t = await stopTimer(String(b.id ?? ""));
    return t ? NextResponse.json({ ok: true, timer: t }) : NextResponse.json({ error: "That timer isn't running" }, { status: 404 });
  }
  if (b.action === "start") {
    const t = (await board()).tasks.find((x) => x.id === b.taskId);
    if (!t) return NextResponse.json({ error: "Task not found in current projects" }, { status: 404 });
    const person = String(b.person || t.assignee);
    if (!person || person === "Unassigned") return NextResponse.json({ error: "Assign the task to someone first" }, { status: 400 });
    try {
      return NextResponse.json({ ok: true, id: await startTimer({ taskId: t.id, taskTitle: t.title, project: t.project, person, by: me?.name ?? "Owner" }) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
