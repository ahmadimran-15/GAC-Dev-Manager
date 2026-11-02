import { NextResponse } from "next/server";
import { board } from "@/lib/clickup";
import { estimatesMap } from "@/lib/estimates";
import { inShift, minutesByPerson, minutesByTask, recentStatusChanges, runningTimers, shiftHours, shiftLabel, statusTimes, timersEnabled } from "@/lib/timers";

export const dynamic = "force-dynamic";

const isDone = (s: string) => /complete|done|closed/.test(s);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
// ClickUp due dates without a time still carry one, so finishing any time on the due day counts as on time
function endOfDay(t: number) {
  const d = new Date(t);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
function startOfWeek() {
  const d = new Date(startOfToday());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

// ClickUp board plus our own data: timers, your estimates (owner only), status changes, performance.
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.has("refresh");
  const [b, tracked, running, estimates, changes, today, week, timersOn, inStatus] = await Promise.all([
    board(force),
    minutesByTask(),
    runningTimers(),
    estimatesMap(),
    recentStatusChanges(20),
    minutesByPerson(startOfToday()),
    minutesByPerson(startOfWeek()),
    timersEnabled(),
    statusTimes(),
  ]);
  const weekStart = startOfWeek();
  const performance = b.team.map((person) => {
    const mine = b.tasks.filter((t) => t.assignee === person);
    const done = mine.filter((t) => isDone(t.status));
    // Estimate accuracy: time actually tracked on finished tasks vs your estimate for them
    const est = done.filter((t) => estimates[t.id]?.my_min && tracked[t.id]);
    const estMin = est.reduce((s, t) => s + (estimates[t.id]!.my_min ?? 0), 0);
    const trackedMin = est.reduce((s, t) => s + tracked[t.id], 0);
    const withDue = done.filter((t) => t.dueAt && t.doneAt);
    return {
      person,
      open: mine.length - done.length,
      done: done.length,
      doneThisWeek: done.filter((t) => (t.doneAt ?? 0) >= weekStart).length,
      trackedToday: today[person] ?? 0,
      trackedWeek: week[person] ?? 0,
      accuracy: estMin ? { tasks: est.length, ratio: trackedMin / estMin } : null,
      onTime: withDue.length ? { tasks: withDue.length, rate: withDue.filter((t) => t.doneAt! <= endOfDay(t.dueAt!)).length / withDue.length } : null,
    };
  });
  const shift = { label: shiftLabel(await shiftHours()), on: await inShift() };
  return NextResponse.json({ ...b, now: Date.now(), tracked, running, estimates, changes, performance, timersOn, shift, inStatus });
}
