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

// before_ms: time already saved on the task from earlier (paused) segments, so a resumed clock carries on from it
export async function runningTimers() {
  return (
    await all<Timer & { before_ms: number | null }>(
      "select t.*, (select sum(o.ended_at - o.started_at) from timers o where o.task_id = t.task_id and o.ended_at is not null) before_ms from timers t where t.ended_at is null order by t.started_at",
    )
  ).map((t) => ({ ...norm(t), before_ms: Number(t.before_ms ?? 0) }));
}

export async function stopTimer(id: string) {
  const t = await get<Timer>("select * from timers where id = ? and ended_at is null", id);
  if (!t) return null;
  const end = Date.now();
  await run("update timers set ended_at = ? where id = ?", end, id);
  // Copy into ClickUp so the task's Track time field fills in. ClickUp's Free plan logs every entry
  // under the API token's owner, so a teammate's segment is named in the entry's description.
  try {
    await pushSegment({ ...norm(t), ended_at: end });
  } catch {
    /* stays in our log; Settings → Time tracking can send it later */
  }
  return { ...norm(t), ended_at: end };
}

// One finished segment into ClickUp's own time tracking, so the task's "Track time" field adds up.
// ClickUp's Free plan books every entry under the API token's owner, so whose time it was goes in the
// description. Anything under 5 seconds is a mis-click and is left out.
async function pushSegment(t: Timer) {
  if (t.ended_at === null) return false;
  const ms = Number(t.ended_at) - Number(t.started_at);
  if (ms < 5_000) return false;
  const me = await clickupMe();
  await pushTimeEntry(t.task_id, Number(t.started_at), ms, me.username === t.person ? "GAC Desk timer" : `GAC Desk timer · ${t.person}`);
  await run("update timers set pushed = 1 where id = ?", t.id);
  return true;
}

// Sends every finished segment ClickUp hasn't got yet (a push that failed, or time tracked before
// teammates' time was being copied over). Safe to run again: each segment is only ever sent once.
export async function pushMissingTime(limit = 500) {
  const rows = (await all<Timer>("select * from timers where ended_at is not null and pushed = 0 order by started_at limit ?", limit)).map(norm);
  let sent = 0;
  let minutes = 0;
  const failed: string[] = [];
  for (const t of rows) {
    try {
      if (await pushSegment(t)) {
        sent++;
        minutes += (Number(t.ended_at) - Number(t.started_at)) / 60000;
      }
    } catch (e) {
      failed.push(e instanceof Error ? e.message : "failed");
    }
  }
  return { sent, minutes: Math.round(minutes), skipped: rows.length - sent - failed.length, failed: failed.length, error: failed[0] ?? null };
}

// Minutes tracked here that ClickUp doesn't have yet
export async function unsentTime() {
  const r = await get<{ n: number; ms: number | null }>("select count(*) n, sum(ended_at - started_at) ms from timers where ended_at is not null and pushed = 0 and ended_at - started_at >= 5000");
  return { segments: Number(r?.n ?? 0), minutes: Math.round(Number(r?.ms ?? 0) / 60000) };
}

// Stop from anywhere (Team page, Working now, a person's card, the portal): every clock on that task stops
export async function stopTask(taskId: string) {
  let last = null;
  for (const t of await all<Timer>("select * from timers where task_id = ? and ended_at is null", taskId)) last = (await stopTimer(t.id)) ?? last;
  return last;
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

// ---------- Shift hours ----------
// Clocks only run during the shift (1:30 pm – 10:30 pm Pakistan time unless changed). At the end of the shift
// every running clock stops and is remembered; at the next shift start those tasks resume if they're still
// in progress. A task moved to in progress outside the shift starts at the next shift start.
const SHIFT_TZ = process.env.SHIFT_TZ || "Asia/Karachi";
export const shiftHours = async () => ({ start: "13:30", end: "22:30", ...JSON.parse((await kvGet("shift_hours")) ?? "{}") }) as { start: string; end: string };
const mins = (hhmm: string) => Number(hhmm.split(":")[0]) * 60 + Number(hhmm.split(":")[1] ?? 0);
export const shiftLabel = (s: { start: string; end: string }) =>
  [s.start, s.end].map((t) => new Date(Date.UTC(2000, 0, 1, Math.floor(mins(t) / 60), mins(t) % 60)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).toLowerCase()).join(" – ");

export async function inShift(at = Date.now()) {
  const { start, end } = await shiftHours();
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: SHIFT_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const now = Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
  const s = mins(start);
  const e = mins(end);
  return s <= e ? now >= s && now < e : now >= s || now < e; // also works for a shift past midnight
}

type Held = { taskId: string; taskTitle: string; project: string | null; person: string };
const heldTasks = async () => JSON.parse((await kvGet("shift_held")) ?? "[]") as Held[];
const hold = async (list: Held[]) => kvSet("shift_held", JSON.stringify(list));

// Runs every minute: end of shift = stop and remember every clock; start of shift = resume them.
export async function shiftTick() {
  if (!(await timersEnabled())) return null;
  const on = await inShift();
  const was = (await kvGet("shift_state")) ?? (on ? "on" : "off");
  if (!on) {
    const running = await runningTimers();
    if (running.length) {
      const held = await heldTasks();
      for (const r of running) if (!held.some((h) => h.taskId === r.task_id && h.person === r.person)) held.push({ taskId: r.task_id, taskTitle: r.task_title, project: r.project, person: r.person });
      await hold(held);
      for (const r of running) await stopTimer(r.id);
    }
    if (was !== "off") await kvSet("shift_state", "off");
    return running.length ? { paused: running.length } : null;
  }
  if (was === "on") return null;
  await kvSet("shift_state", "on");
  // Shift started: resume what was held, if ClickUp still says in progress for the same person
  const held = await heldTasks();
  await hold([]);
  const { board } = await import("@/lib/clickup");
  const tasks = new Map((await board(true)).tasks.map((t) => [t.id, t]));
  let resumed = 0;
  for (const h of held) {
    const t = tasks.get(h.taskId);
    if (!t || !ACTIVE_STATUS.test(t.status) || t.assignee !== h.person) continue;
    if ((await runningTimers()).some((r) => r.task_id === h.taskId)) continue;
    await startTimer({ taskId: h.taskId, taskTitle: t.title, project: t.project, person: h.person, by: "Shift start", fromStatus: true });
    resumed++;
  }
  return { resumed };
}

export async function setShiftHours(start: string, end: string) {
  const ok = (s: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s);
  if (!ok(start) || !ok(end) || start === end) throw new Error("Pick a start and end time, e.g. 13:30 and 22:30");
  await kvSet("shift_hours", JSON.stringify({ start, end }));
  await kvSet("shift_state", (await inShift()) ? "on" : "off");
}

// Team page → "Start all in progress": a clock for every task in progress / revision that has none yet
export async function startAllActive(by: string) {
  const { board } = await import("@/lib/clickup");
  const running = await runningTimers();
  let started = 0;
  for (const t of (await board(true)).tasks) {
    if (!ACTIVE_STATUS.test(t.status) || t.assignee === "Unassigned" || running.some((r) => r.task_id === t.id)) continue;
    await startTimer({ taskId: t.id, taskTitle: t.title, project: t.project, person: t.assignee, by, fromStatus: true });
    started++;
  }
  return started;
}

// "Stop all": every running clock stops (tracking stays on; a task's clock starts again when its status changes)
export async function stopAll() {
  const running = await runningTimers();
  for (const r of running) await stopTimer(r.id);
  return running.length;
}

// keepOthers: the owner starting one task from the Team page leaves that person's other clocks running;
// a teammate's own Start (portal) switches them to this task.
export async function startTimer(t: { taskId: string; taskTitle: string; project?: string | null; person: string; by: string; fromStatus?: boolean; keepOthers?: boolean }) {
  if (!(await timersEnabled())) throw new Error("Time tracking is off (Settings → Time tracking).");
  if (!(await inShift())) throw new Error(`Outside shift hours (${shiftLabel(await shiftHours())}). Clocks resume when the shift starts.`);
  if (!t.fromStatus && !t.keepOthers) await stopPersonTimers(t.person);
  // Already running (e.g. "Start all" and a ClickUp status change at the same moment): keep that one
  const runningId = async () => (await get<{ id: string }>("select id from timers where task_id = ? and ended_at is null", t.taskId))?.id;
  const existing = await runningId();
  if (existing) return existing;
  const id = uid("t_");
  try {
    await run(
      "insert into timers (id, task_id, task_title, project, person, started_at, started_by) values (?,?,?,?,?,?,?)",
      id, t.taskId, t.taskTitle, t.project ?? null, t.person, Date.now(), t.by,
    );
  } catch (e) {
    const other = await runningId(); // the database's one-running-clock-per-task rule caught a race
    if (other) return other;
    throw e;
  }
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

// Shared by the background worker and the webhook route (they can load this file separately)
const lock = globalThis as unknown as { __gacStatusSync?: boolean };
export async function syncStatusTimers(tasks: { id: string; title: string; project: string; assignee: string; status: string }[]) {
  if (lock.__gacStatusSync || !(await timersEnabled())) return { started: 0, stopped: 0 };
  lock.__gacStatusSync = true;
  try {
    const seen = JSON.parse((await kvGet("status_seen")) ?? "{}") as Record<string, string>;
    const running = await runningTimers();
    const shift = await inShift();
    let held = shift ? null : await heldTasks();
    let started = 0;
    let stopped = 0;
    for (const t of tasks) {
      const before = seen[t.id];
      const changed = before !== t.status; // only act on a change, so a manual pause/start sticks
      seen[t.id] = t.status;
      if (!changed) continue;
      // A change the webhook missed still goes in the status log (for time in each status)
      if (before) {
        const last = await get<{ to_status: string }>("select to_status from status_log where task_id = ? order by at desc limit 1", t.id);
        if (last?.to_status !== t.status) await logStatus({ taskId: t.id, title: t.title, person: t.assignee, from: before, to: t.status, source: "clickup" });
      }
      const mine = running.filter((r) => r.task_id === t.id);
      // Outside the shift nothing runs: moved to in progress = starts at the next shift; moved out = not resumed
      if (held) {
        held = held.filter((h) => h.taskId !== t.id);
        if (ACTIVE_STATUS.test(t.status) && t.assignee !== "Unassigned") held.push({ taskId: t.id, taskTitle: t.title, project: t.project, person: t.assignee });
        continue;
      }
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
    if (held) await hold(held);
    await kvSet("status_seen", JSON.stringify(seen));
    return { started, stopped };
  } finally {
    lock.__gacStatusSync = false;
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

// Time in each status per task, from our status log: { status now, since when, minutes in earlier statuses }.
// The status now keeps counting on the page from `since`. Statuses before the first logged change are unknown.
export async function statusTimes() {
  const rows = await all<{ task_id: string; to_status: string; at: number }>("select task_id, to_status, at from status_log order by at");
  const out: Record<string, { status: string; since: number; spent: Record<string, number> }> = {};
  for (const r of rows) {
    const at = Number(r.at);
    const o = out[r.task_id];
    const spent = o?.spent ?? {};
    if (o && o.status !== r.to_status) spent[o.status] = Math.round((spent[o.status] ?? 0) + (at - o.since) / 60000);
    if (!o || o.status !== r.to_status) out[r.task_id] = { status: r.to_status, since: at, spent };
  }
  return out;
}

export async function statusHistory(taskId: string) {
  return (await all<{ from_status: string | null; to_status: string; source: string; person: string | null; at: number }>("select from_status, to_status, source, person, at from status_log where task_id = ? order by at desc limit 30", taskId)).map((r) => ({ ...r, at: Number(r.at) }));
}

export async function recentStatusChanges(limit = 15) {
  return (await all<{ task_id: string; task_title: string | null; person: string | null; from_status: string | null; to_status: string; source: string; at: number }>("select * from status_log order by at desc limit ?", limit)).map((r) => ({ ...r, at: Number(r.at) }));
}
