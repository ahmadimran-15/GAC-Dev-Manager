import { all, get, kvGet, kvSet, run, uid } from "@/lib/db";
import { clickupMe, markInProgress, pushTimeEntry } from "@/lib/clickup";

// Time tracking owned by the dashboard: every start and stop is stamped by the server clock, so
// nobody can back-date it. One running timer per person; pause = stop, resume = a new segment.

export interface Timer {
  id: string;
  task_id: string;
  task_title: string;
  project: string | null;
  person: string;
  started_at: number;
  ended_at: number | null;
  started_by: string | null;
  pushed: number;
}

const norm = (t: Timer): Timer => ({ ...t, started_at: Number(t.started_at), ended_at: t.ended_at === null ? null : Number(t.ended_at) });

export async function runningTimers() {
  return (await all<Timer>("select * from timers where ended_at is null order by started_at")).map(norm);
}

export async function stopTimer(id: string) {
  const t = await get<Timer>("select * from timers where id = ? and ended_at is null", id);
  if (!t) return null;
  const end = Date.now();
  await run("update timers set ended_at = ? where id = ?", end, id);
  // Copy into ClickUp when the person is the API token's owner (the only case ClickUp's Free plan allows)
  try {
    const me = await clickupMe();
    if (me.username === t.person && end - Number(t.started_at) > 60_000) {
      await pushTimeEntry(t.task_id, Number(t.started_at), end - Number(t.started_at));
      await run("update timers set pushed = 1 where id = ?", id);
    }
  } catch {
    /* stays in our log */
  }
  return { ...norm(t), ended_at: end };
}

export async function stopPersonTimers(person: string) {
  for (const t of await all<Timer>("select * from timers where person = ? and ended_at is null", person)) await stopTimer(t.id);
}

// Manual start (button): one running timer per person, and the task moves to "in progress" in ClickUp.
// Status-driven start (fromStatus): the task is already in progress; other tasks keep running.
// Master switch (Team page): off = every running timer stops and nothing starts one
export const timersEnabled = async () => (await kvGet("timers_on")) !== "0";
export async function setTimersEnabled(on: boolean) {
  await kvSet("timers_on", on ? "1" : "0");
  if (!on) for (const t of await runningTimers()) await stopTimer(t.id);
  // Turning back on: remember today's statuses so only changes from now on start clocks
  else await kvSet("status_seen", "{}");
}

export async function startTimer(t: { taskId: string; taskTitle: string; project?: string | null; person: string; by: string; fromStatus?: boolean }) {
  if (!(await timersEnabled())) throw new Error("Timers are switched off (Team page → Timers).");
  if (!t.fromStatus) await stopPersonTimers(t.person);
  const id = uid("t_");
  await run(
    "insert into timers (id, task_id, task_title, project, person, started_at, started_by) values (?,?,?,?,?,?,?)",
    id, t.taskId, t.taskTitle, t.project ?? null, t.person, Date.now(), t.by,
  );
  if (!t.fromStatus)
    markInProgress(t.taskId)
      .then((m) => m && logStatus({ taskId: t.taskId, title: m.title, person: t.person, from: m.from, to: m.to, source: "timer" }))
      .catch(() => {});
  return id;
}

// ---------- Timers follow the ClickUp status ----------
// "in progress" or "revision" = the clock runs for the assignee; any other status pauses it;
// complete/closed stops it for good (the task's total is what was tracked).
export const ACTIVE_STATUS = /progress|revision/;

let syncing = false;
export async function syncStatusTimers(tasks: { id: string; title: string; project: string; assignee: string; status: string }[]) {
  if (syncing || !(await timersEnabled())) return { started: 0, stopped: 0 };
  syncing = true;
  try {
    const seen = JSON.parse((await kvGet("status_seen")) ?? "{}") as Record<string, string>;
    const running = await runningTimers();
    let started = 0;
    let stopped = 0;
    for (const t of tasks) {
      const changed = seen[t.id] !== t.status; // only act on a change, so a manual pause/start sticks
      seen[t.id] = t.status;
      if (!changed) continue;
      const mine = running.filter((r) => r.task_id === t.id);
      if (ACTIVE_STATUS.test(t.status) && t.assignee !== "Unassigned") {
        if (!mine.length) {
          await startTimer({ taskId: t.id, taskTitle: t.title, project: t.project, person: t.assignee, by: "ClickUp status", fromStatus: true });
          started++;
        }
      } else if (mine.length) {
        for (const r of mine) await stopTimer(r.id);
        stopped++;
      }
    }
    // A task that left the current projects (moved, archived, deleted) can't keep a clock running
    const ids = new Set(tasks.map((t) => t.id));
    if (tasks.length) for (const r of running) if (!ids.has(r.task_id)) (await stopTimer(r.id), stopped++);
    await kvSet("status_seen", JSON.stringify(seen));
    return { started, stopped };
  } finally {
    syncing = false;
  }
}

// Tracked minutes per task (running timers count up to now)
export async function minutesByTask(): Promise<Record<string, number>> {
  const now = Date.now();
  const rows = await all<{ task_id: string; started_at: number; ended_at: number | null }>("select task_id, started_at, ended_at from timers");
  const out: Record<string, number> = {};
  for (const r of rows) out[r.task_id] = (out[r.task_id] ?? 0) + ((r.ended_at === null ? now : Number(r.ended_at)) - Number(r.started_at)) / 60000;
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

// Tracked minutes per person since a moment (e.g. start of today / this week)
export async function minutesByPerson(since: number): Promise<Record<string, number>> {
  const now = Date.now();
  const rows = await all<{ person: string; started_at: number; ended_at: number | null }>("select person, started_at, ended_at from timers where ended_at is null or ended_at > ?", since);
  const out: Record<string, number> = {};
  for (const r of rows) {
    const s = Math.max(Number(r.started_at), since);
    const e = r.ended_at === null ? now : Number(r.ended_at);
    if (e > s) out[r.person] = (out[r.person] ?? 0) + (e - s) / 60000;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

export async function timersForTask(taskId: string) {
  return (await all<Timer>("select * from timers where task_id = ? order by started_at desc limit 50", taskId)).map(norm);
}

// ---------- Status changes, stamped by our clock ----------

export async function logStatus(s: { taskId: string; title?: string; person?: string; from?: string | null; to: string; source: "clickup" | "dashboard" | "timer" }) {
  await run(
    "insert into status_log (id, task_id, task_title, person, from_status, to_status, source, at) values (?,?,?,?,?,?,?,?)",
    uid("s_"), s.taskId, s.title ?? null, s.person ?? null, s.from ?? null, s.to, s.source, Date.now(),
  );
}

export async function statusHistory(taskId: string) {
  return (await all<{ from_status: string | null; to_status: string; source: string; person: string | null; at: number }>("select from_status, to_status, source, person, at from status_log where task_id = ? order by at desc limit 30", taskId)).map((r) => ({ ...r, at: Number(r.at) }));
}

export async function recentStatusChanges(limit = 15) {
  return (await all<{ task_id: string; task_title: string | null; person: string | null; from_status: string | null; to_status: string; source: string; at: number }>("select * from status_log order by at desc limit ?", limit)).map((r) => ({ ...r, at: Number(r.at) }));
}
