"use client";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, MessageSquare, Play, PlayCircle, RotateCw, Sparkles, Square, X } from "lucide-react";
import Link from "next/link";
import type { Board } from "@/lib/clickup";
import { api, useLive } from "@/components/Live";
import Dropdown from "@/components/Dropdown";
import { Avatar, Pill, TEAM_ORDER, ago, teamKey } from "@/components/ui";
import { TeamSkeleton } from "@/components/Skeleton";
import { EstimateBox, StatusSelect, TimerButton, clock, hm, useTick, type Estimate, type RunningTimer } from "@/components/TaskControls";

const FILTERS = ["Open", "In progress", "Other", "Blocked", "Done", "All"] as const;
// Open = not started yet (to do / pending); Other = every remaining status (client pending, UAT testing, waiting for approval…)
const isOpen = (s: string) => /^(to ?do|pending|open)$/.test(s.trim());
const inWork = (s: string) => /progress|revision/.test(s);
const bucket = (s: string) => (isDone(s) ? "Done" : /block/.test(s) ? "Blocked" : inWork(s) ? "In progress" : isOpen(s) ? "Open" : "Other");

type T = Board["tasks"][number];
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_OPTIONS = [{ value: "", label: "Any" }, { value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }];
const PRIORITY_TONE = { urgent: "red", high: "amber", normal: "gray", low: "gray" } as const;
const STATUS_RANK = (s: string) => (/block/.test(s) ? 0 : /progress|revision/.test(s) ? 1 : /complete|done|closed/.test(s) ? 4 : /to do|open/.test(s) ? 2 : 3);
// The team in your order (Ali first), anyone else after them by name
const teamRank = (name: string) => { const i = TEAM_ORDER.indexOf(teamKey(name)); return i < 0 ? TEAM_ORDER.length : i; };
const byPerson = (a: string, b: string) => teamRank(a) - teamRank(b) || a.localeCompare(b);
const byDue = (a: T, b: T) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
const SORTS = {
  priority: { label: "Priority", fn: (a: T, b: T) => (PRIORITY_RANK[a.priority ?? "normal"] ?? 2) - (PRIORITY_RANK[b.priority ?? "normal"] ?? 2) || byDue(a, b) },
  due: { label: "Due date", fn: byDue },
  person: { label: "Person", fn: (a: T, b: T) => byPerson(a.assignee, b.assignee) || (PRIORITY_RANK[a.priority ?? "normal"] ?? 2) - (PRIORITY_RANK[b.priority ?? "normal"] ?? 2) },
  status: { label: "Status", fn: (a: T, b: T) => STATUS_RANK(a.status) - STATUS_RANK(b.status) || a.status.localeCompare(b.status) },
  project: { label: "Project", fn: (a: T, b: T) => a.project.localeCompare(b.project) },
};
const isDone = (s: string) => /complete|done|closed/.test(s);
// 45m · 3h 20m · 2d 4h
const dur = (m: number) => (m < 60 ? `${Math.max(0, Math.round(m))}m` : m < 1440 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`);
const when = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

interface Change {
  task_id: string;
  task_title: string | null;
  person: string | null;
  from_status: string | null;
  to_status: string;
  source: string;
  at: number;
}

interface Perf {
  person: string;
  open: number;
  done: number;
  doneThisWeek: number;
  trackedToday: number;
  trackedWeek: number;
  accuracy: { tasks: number; ratio: number } | null;
  onTime: { tasks: number; rate: number } | null;
}

type TeamData = Board & {
  now: number;
  tracked: Record<string, number>;
  running: RunningTimer[];
  estimates: Record<string, Estimate>;
  changes: Change[];
  performance: Perf[];
  timersOn: boolean;
  shift?: { label: string; on: boolean };
  inStatus?: Record<string, { status: string; since: number; spent: Record<string, number> }>;
};

interface Detail {
  id: string;
  title: string;
  project: string;
  assignee: string;
  status: string;
  description: string;
  stage: string | null;
  url?: string;
  comments: { user: string; text: string; at: number }[];
  looms: string[];
}

function TaskPanel({ id, data, now, onClose, reload }: { id: string; data: TeamData; now: number; onClose: () => void; reload: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [history, setHistory] = useState<{ from_status: string | null; to_status: string; source: string; person: string | null; at: number }[]>([]);
  const [entries, setEntries] = useState<{ id: string; person: string; started_at: number; ended_at: number | null }[]>([]);

  const loadExtra = useCallback(() => {
    api<{ history: typeof history }>(`/api/tasks/${id}/status`).then((r) => setHistory(r.history)).catch(() => {});
    api<{ entries: typeof entries }>(`/api/timers?task=${id}`).then((r) => setEntries(r.entries)).catch(() => {});
  }, [id]);

  useEffect(() => {
    setD(null);
    api<Detail>(`/api/tasks/${id}`).then(setD).catch((e) => setErr(e.message));
    loadExtra();
  }, [id, loadExtra]);

  const running = data.running.find((r) => r.task_id === id);
  const refresh = () => (reload(), loadExtra());

  const [ctx, setCtx] = useState<{ summary: string; looms: string[] } | null>(null);
  const [ctxBusy, setCtxBusy] = useState(false);
  useEffect(() => setCtx(null), [id]);
  async function getContext() {
    setCtxBusy(true);
    try {
      setCtx(await api<{ summary: string; looms: string[] }>(`/api/tasks/${id}/context`, {}));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gemini failed");
    } finally {
      setCtxBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/15" onClick={onClose}>
      <aside className="slide-in flex h-full w-[520px] max-w-full flex-col border-l border-[var(--line)] bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-5">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold leading-snug">{d?.title ?? "Loading…"}</div>
            {d && <div className="mt-1 text-[12.5px] text-[var(--muted)]">{d.project} · {d.stage} · {d.assignee}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button className="btn btn-sm" disabled={!d || ctxBusy} onClick={getContext} title="Summary of the task and its comments, with Loom links">
              <Sparkles size={12} className={ctxBusy ? "animate-pulse" : ""} /> {ctxBusy ? "Reading…" : "Get context"}
            </button>
            <button className="btn btn-ghost !h-8 !w-8 !p-0" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="scroll flex-1 space-y-6 px-6 pb-8">
          {err && <p className="text-[var(--red)]">{err}</p>}
          {ctx && (
            <div className="rounded-xl bg-[var(--bg)] px-4 py-3">
              <div className="eyebrow mb-1.5">Context</div>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--ink-2)]">{ctx.summary}</p>
              {ctx.looms.length > 0 && (
                <div className="mt-2 space-y-1">
                  {ctx.looms.map((l) => (
                    <a key={l} href={l} target="_blank" className="flex items-center gap-2 text-[13px] text-[#625df5] hover:underline">
                      <PlayCircle size={14} className="shrink-0" /> <span className="truncate">{l}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          {!d && !err && <Loader2 className="animate-spin text-[var(--muted)]" size={18} />}
          {d && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusSelect taskId={d.id} status={d.status} onChanged={refresh} />
                {(data.timersOn || running) && <TimerButton taskId={d.id} assignee={d.assignee} running={running} now={now} onChanged={refresh} savedMin={data.tracked[d.id] ?? 0} />}
                {d.url && (
                  <a href={d.url} target="_blank" className="btn btn-sm btn-ghost">
                    Open in ClickUp <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <div>
                <div className="eyebrow mb-2">Time · only you see this</div>
                <EstimateBox taskId={d.id} initial={data.estimates[d.id]} tracked={data.tracked[d.id] ?? 0} onSaved={reload} />
              </div>
              {(() => {
                // Time in each status (from our status log), the status now still counting
                const s = data.inStatus?.[d.id];
                if (!s) return null;
                const rows = Object.entries({ ...s.spent, [s.status]: (s.spent[s.status] ?? 0) + (s.status === d.status ? (now - s.since) / 60000 : 0) }).sort((a, b) => b[1] - a[1]);
                return (
                  <div>
                    <div className="eyebrow mb-2">Time in each status</div>
                    <div className="space-y-1 text-[13px]">
                      {rows.map(([st, m]) => (
                        <div key={st} className="flex justify-between gap-3">
                          <span className={st === d.status ? "font-medium" : "text-[var(--ink-2)]"}>
                            {st}
                            {st === d.status && <span className="font-normal text-[var(--muted)]"> · now</span>}
                          </span>
                          <span className="tnum">{dur(m)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[12px] text-[var(--muted)]">Counted since {when(Math.min(s.since, ...history.map((h) => h.at)))}, when GAC Desk started logging this task's changes.</p>
                  </div>
                );
              })()}
              {d.looms.length > 0 && (
                <div>
                  <div className="eyebrow mb-2">Loom videos</div>
                  <div className="space-y-1.5">
                    {d.looms.map((l) => (
                      <a key={l} href={l} target="_blank" className="flex items-center gap-2 rounded-lg bg-[var(--bg)] px-3 py-2 text-[13px] hover:bg-[var(--hover)]">
                        <PlayCircle size={15} className="shrink-0 text-[#625df5]" /> <span className="truncate">{l}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {d.description && (
                <div>
                  <div className="eyebrow mb-2">Description</div>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--ink-2)]">{d.description}</p>
                </div>
              )}
              {(entries.length > 0 || history.length > 0) && (
                <div>
                  <div className="eyebrow mb-2">Log</div>
                  <div className="space-y-1 text-[12.5px] text-[var(--ink-2)]">
                    {[
                      ...entries.map((e) => ({ at: e.started_at, text: `${e.person} worked ${e.ended_at ? clock(e.started_at, e.ended_at) : "· running"}` })),
                      ...history.map((h, i) => {
                        // How long it sat in the old status, and the time worked on it by then
                        const prev = history[i + 1];
                        const sat = prev && prev.to_status === h.from_status ? ` after ${dur((h.at - prev.at) / 60000)} in ${h.from_status}` : "";
                        const worked = entries.reduce((sum, e) => sum + Math.max(0, Math.min(e.ended_at ?? now, h.at) - e.started_at), 0) / 60000;
                        return { at: h.at, text: `${h.person ?? "Someone"}: ${h.from_status ?? "?"} → ${h.to_status}${sat}${worked >= 1 ? ` · ${hm(Math.round(worked))} worked by then` : ""}` };
                      }),
                    ]
                      .sort((a, b) => b.at - a.at)
                      .slice(0, 20)
                      .map((x, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="tnum w-[110px] shrink-0 text-[var(--muted)]">{when(x.at)}</span>
                          <span>{x.text}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              <div>
                <div className="eyebrow mb-2 flex items-center justify-between gap-2">
                  <span>Updates from the team · {d.comments.length}</span>
                  <a href={`/api/tasks/${d.id}/chat`} className="btn btn-sm !h-7 normal-case" title="Open this task's comments in the inbox and reply from there">
                    Reply <MessageSquare size={12} />
                  </a>
                </div>
                <div className="space-y-4">
                  {d.comments.map((c, i) => (
                    <div key={i} className="flex gap-3">
                      <Avatar name={c.user} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]">
                          <b className="font-medium">{c.user}</b> <span className="text-[var(--muted)]">· {ago(c.at)}</span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--ink-2)]">{c.text}</p>
                      </div>
                    </div>
                  ))}
                  {!d.comments.length && <p className="text-[13px] text-[var(--muted)]">No comments yet.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// Time spent on one project: total, and per person (tasks, tracked, estimate)
function ProjectTime({
  name,
  tasks,
  trackedOf,
  targetOf,
}: {
  name: string;
  tasks: Board["tasks"];
  trackedOf: (t: Board["tasks"][number]) => number;
  targetOf: (t: Board["tasks"][number]) => number | null;
}) {
  const people = new Map<string, { tasks: number; done: number; tracked: number; target: number }>();
  for (const t of tasks) {
    const p = people.get(t.assignee) ?? { tasks: 0, done: 0, tracked: 0, target: 0 };
    p.tasks++;
    if (isDone(t.status)) p.done++;
    p.tracked += trackedOf(t);
    p.target += targetOf(t) ?? 0;
    people.set(t.assignee, p);
  }
  const rows = [...people].sort((a, b) => b[1].tracked - a[1].tracked);
  const total = rows.reduce((s, [, p]) => s + p.tracked, 0);
  const target = rows.reduce((s, [, p]) => s + p.target, 0);
  return (
    <div className="card mb-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className="text-[13.5px] font-semibold">{name}</div>
        <div className="tnum text-[13px] text-[var(--ink-2)]">
          <b className="text-[18px] font-semibold text-[var(--ink)]">{hm(total)}</b> tracked
          {target ? <span className="text-[var(--muted)]"> of {hm(target)} estimated</span> : null}
        </div>
        <div className="text-[12.5px] text-[var(--muted)]">
          {tasks.filter((t) => isDone(t.status)).length} of {tasks.length} tasks done
        </div>
      </div>
      <table className="tnum mt-3 w-full text-left text-[13px]">
        <thead>
          <tr className="text-[12px] text-[var(--muted)]">
            {["Person", "Tasks done", "Time tracked", "Estimated", ""].map((h, i) => (
              <th key={i} className="pb-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([person, p]) => {
            const over = p.target && p.tracked > p.target;
            return (
              <tr key={person} className="border-t border-[var(--line)]">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <Avatar name={person} size={22} /> {person}
                  </span>
                </td>
                <td className="py-2">
                  {p.done} / {p.tasks}
                </td>
                <td className={`py-2 ${over ? "text-[var(--red)]" : ""}`}>{hm(p.tracked)}</td>
                <td className="py-2 text-[var(--ink-2)]">{p.target ? hm(p.target) : "—"}</td>
                <td className="py-2 text-right text-[12px] text-[var(--muted)]">{p.target && p.tracked ? `${Math.round((p.tracked / p.target) * 100)}% of estimate` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Tasks per person by state, as stacked horizontal bars (done · in progress · open)
const STATE = [
  { key: "done", label: "Done", color: "#22794d" },
  { key: "active", label: "In progress", color: "#1d63b5" },
  { key: "open", label: "Open", color: "#c9821a" },
] as const;

function TeamBars({ tasks, people, perf, onPick }: { tasks: Board["tasks"]; people: string[]; perf: Map<string, Perf>; onPick: (p: string) => void }) {
  const rows = people
    .map((name) => {
      const mine = tasks.filter((t) => t.assignee === name);
      const done = mine.filter((t) => isDone(t.status)).length;
      const active = mine.filter((t) => !isDone(t.status) && /progress|revision/.test(t.status)).length;
      return { name, done, active, open: mine.length - done - active, total: mine.length };
    })
    .sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-[var(--ink-2)]">
        {STATE.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div className="space-y-3">
        {rows.map((r) => {
          const p = perf.get(r.name);
          return (
            <button key={r.name} className="block w-full text-left" onClick={() => onPick(r.name)} title={`${r.name}: ${r.done} done, ${r.active} in progress, ${r.open} open`}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="truncate font-medium text-[var(--ink)]">{r.name}</span>
                <span className="tnum shrink-0 text-[var(--muted)]">
                  {r.total} tasks{p?.trackedWeek ? ` · ${hm(p.trackedWeek)} this week` : ""}
                </span>
              </div>
              <div className="flex h-3 gap-[2px]" style={{ width: `${Math.max(6, (r.total / max) * 100)}%` }}>
                {STATE.map((s) => {
                  const n = r[s.key];
                  return n ? <span key={s.key} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flex: n, background: s.color }} title={`${s.label}: ${n}`} /> : null;
                })}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] text-[var(--muted)]">Tasks in current projects. Click a person to see their tasks.</p>
    </div>
  );
}

export default function Team() {
  const [data, setData] = useState<TeamData | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [f, setF] = useState<(typeof FILTERS)[number]>("Open");
  const [loading, setLoading] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [sort, setSort] = useState("priority");
  const [prio, setPrio] = useState(""); // priority filter: "" = any
  const [wPerson, setWPerson] = useState(""); // Working now filters
  const [wPrio, setWPrio] = useState("");
  const now = useTick(data?.now);

  // quiet = background refresh: no spinner, errors ignored
  const load = useCallback(async (refresh = false, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await api<TeamData>(`/api/team${refresh ? "?refresh=1" : ""}`));
    } catch (e) {
      if (!quiet) throw e;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);
  // Status changes already clear the server's ClickUp cache, so a plain reload is enough
  const reload = useCallback(() => load(), [load]);

  // Auto-refresh (remembered in this browser): every 15 s, a fresh ClickUp read every 2 min, right away when
  // you come back to the tab; paused while the tab is hidden
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    try {
      setAuto(localStorage.getItem("gac_team_auto") !== "0");
    } catch {}
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!auto) return;
    let ticks = 0;
    const tick = () => !document.hidden && load(++ticks % 8 === 0, true);
    const id = setInterval(tick, 15_000);
    const back = () => !document.hidden && load(false, true);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [auto, load]);
  const toggleAuto = () => {
    setAuto((a) => {
      try {
        localStorage.setItem("gac_team_auto", a ? "0" : "1");
      } catch {}
      return !a;
    });
  };

  const all = data?.tasks ?? [];
  const live = data?.source === "clickup";
  const tasks = all
    .filter((t) => (!person || t.assignee === person) && (!project || t.project === project) && (!prio || (t.priority ?? "normal") === prio))
    .filter((t) => f === "All" || bucket(t.status) === f)
    .sort(SORTS[sort as keyof typeof SORTS]?.fn ?? SORTS.priority.fn);
  const current = (data?.projectInfo ?? []).filter((p) => p.current);
  const otherStages = [...new Set((data?.projectInfo ?? []).filter((p) => !p.current).map((p) => p.stage))];
  const runningFor = (taskId: string) => data?.running.find((r) => r.task_id === taskId);
  // The time a task should take: your estimate, else Gemini's, else ClickUp's
  const targetOf = (t: { id: string; estimateMin: number | null }) => data?.estimates[t.id]?.my_min ?? data?.estimates[t.id]?.ai_min ?? t.estimateMin ?? null;
  // Minutes since the last refresh, so running clocks keep counting between refreshes
  const since = data ? Math.max(0, (now - data.now) / 60000) : 0;
  const liveFor = (person: string, base: number) => base + since * (data?.running.filter((r) => r.person === person).length ?? 0);
  const trackedOf = (t: { id: string; spentMin: number }) => Math.round(((data?.tracked[t.id] ?? 0) || t.spentMin) + (runningFor(t.id) ? since : 0));
  const [estimating, setEstimating] = useState(false);
  const [side, setSide] = useState<"projects" | "performance">("projects");
  const { toast } = useLive();
  const perf = new Map((data?.performance ?? []).map((p) => [p.person, p]));

  return (
    <div className="fade-in mx-auto w-full px-4 pb-20 pt-6 md:px-6 md:pt-10 xl:px-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-[15px] text-[var(--ink-2)]">
            {live ? `Live from ClickUp · ${current.length} current projects · ${all.filter((t) => !isDone(t.status)).length} open tasks` : "Test data. Add CLICKUP_TOKEN to .env to load your real tasks."}
            {data?.error && <span className="text-[var(--red)]"> ClickUp error: {data.error}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {data && !data.timersOn && (
            <Link href="/settings#time" className="btn btn-sm !text-[var(--muted)]" title="Switch time tracking on in Settings">
              <span className="dot" style={{ background: "#cfcfca" }} /> Time tracking off
            </Link>
          )}
          {data?.timersOn && (() => {
            // Tasks in progress / revision without a clock, and the clocks running now
            const idle = all.filter((t) => /progress|revision/.test(t.status) && t.assignee !== "Unassigned" && !runningFor(t.id)).length;
            const bulk = async (action: "start-all" | "stop-all") => {
              if (action === "stop-all" && !confirm(`Stop all ${data.running.length} running timers?`)) return;
              try {
                const r = await api<{ started?: number; stopped?: number }>("/api/timers", { action });
                toast(action === "start-all" ? `Started ${r.started} timer${r.started === 1 ? "" : "s"}` : `Stopped ${r.stopped} timer${r.stopped === 1 ? "" : "s"}`);
                await load();
              } catch (e) {
                toast(e instanceof Error ? e.message : "Failed", "error");
              }
            };
            return (
              <>
                <span className="hidden items-center gap-1.5 text-[12.5px] text-[var(--muted)] lg:inline-flex" title="Clocks follow ClickUp: in progress / revision runs, any other status stops. Only during the shift (Pakistan time).">
                  <span className="dot" style={{ background: data.shift?.on ? "var(--green)" : "var(--amber)" }} />
                  {data.shift?.on ? `Shift ${data.shift.label}` : `Paused until ${data.shift?.label.split(" – ")[0] ?? "shift start"}`}
                </span>
                {idle > 0 && (
                  <button className="btn btn-sm" disabled={!data.shift?.on} title={data.shift?.on ? "Start a timer for every task in progress or revision" : "Outside shift hours"} onClick={() => bulk("start-all")}>
                    <Play size={12} /> Start all in progress ({idle})
                  </button>
                )}
                {data.running.length > 0 && (
                  <button className="btn btn-sm !border-[var(--red)] !text-[var(--red)]" onClick={() => bulk("stop-all")}>
                    <Square size={11} fill="currentColor" /> Stop all ({data.running.length})
                  </button>
                )}
              </>
            );
          })()}
          <button
            className="btn btn-sm"
            disabled={estimating || !live}
            title="Gemini's strict estimate for every open task that has none yet"
            onClick={async () => {
              setEstimating(true);
              try {
                const r = await api<{ estimated: number }>("/api/estimates", {});
                await load();
                toast(r.estimated ? `Gemini estimated ${r.estimated} open task${r.estimated === 1 ? "" : "s"}` : "Every open task already has an estimate");
              } catch (e) {
                toast(e instanceof Error ? e.message : "Gemini failed", "error");
              } finally {
                setEstimating(false);
              }
            }}
          >
            <Sparkles size={13} className={estimating ? "animate-pulse" : ""} /> {estimating ? "Estimating…" : "Estimate open tasks"}
          </button>
          <button className="btn btn-sm" onClick={() => load(true)} disabled={loading} title={data ? `Updated ${ago(data.now, now)}` : ""}>
            <RotateCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button className="btn btn-sm" onClick={toggleAuto} title={auto ? "Refreshing every 15 s (ClickUp every 2 min). Click to stop." : "Click to refresh automatically"}>
            <span className="dot" style={{ background: auto ? "var(--green)" : "#cfcfca" }} /> Auto-refresh {auto ? "on" : "off"}
            {auto && data && <span className="font-normal text-[var(--muted)]"> · {Math.max(0, Math.round((now - data.now) / 1000))}s ago</span>}
          </button>
        </div>
      </div>

      {!data && <TeamSkeleton />}

      {/* Working now */}
      {data && data.running.length > 0 && (() => {
        // Grouped by person in your order (Ali first), filterable by person and priority
        const prioOf = (taskId: string) => all.find((t) => t.id === taskId)?.priority ?? "normal";
        const shown = data.running
          .filter((r) => (!wPerson || r.person === wPerson) && (!wPrio || prioOf(r.task_id) === wPrio))
          .sort((a, b) => byPerson(a.person, b.person) || (PRIORITY_RANK[prioOf(a.task_id)] ?? 2) - (PRIORITY_RANK[prioOf(b.task_id)] ?? 2) || a.started_at - b.started_at);
        const people = [...new Set(data.running.map((r) => r.person))].sort(byPerson);
        return (
          <div className="mt-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13.5px] font-semibold">
                Working now <span className="tnum font-normal text-[var(--muted)]">{shown.length === data.running.length ? data.running.length : `${shown.length} of ${data.running.length}`}</span>
              </h2>
              <div className="flex items-center gap-1">
                <Dropdown label="Person" align="right" value={wPerson} onChange={setWPerson} options={[{ value: "", label: "Everyone" }, ...people.map((p) => ({ value: p, label: `${p} · ${data.running.filter((r) => r.person === p).length}` }))]} />
                <Dropdown label="Priority" align="right" value={wPrio} onChange={setWPrio} options={PRIORITY_OPTIONS} />
              </div>
            </div>
            <div className="card divide-y divide-[var(--line)]">
              {shown.map((r, i) => {
                const p = prioOf(r.task_id);
                const first = shown[i - 1]?.person !== r.person;
                return (
                  <div key={r.id} className={`flex items-center gap-3 px-5 py-2.5 text-[13.5px] ${first && i > 0 ? "border-t-2 !border-t-[var(--line-2)]" : ""}`}>
                    <span className="dot" style={{ background: "var(--green)" }} />
                    <Avatar name={r.person} size={24} />
                    <span className={`w-[140px] shrink-0 truncate ${first ? "font-medium" : "text-[var(--muted)]"}`}>{r.person}</span>
                    <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setOpenTask(r.task_id)}>
                      {p !== "normal" && <Pill tone={PRIORITY_TONE[p]}>{p}</Pill>} {r.task_title} <span className="text-[var(--muted)]">· {r.project}</span>
                    </button>
                    <TimerButton taskId={r.task_id} assignee={r.person} running={r} now={now} onChanged={reload} />
                  </div>
                );
              })}
              {!shown.length && <div className="p-6 text-center text-[13px] text-[var(--muted)]">No running clocks match these filters</div>}
            </div>
          </div>
        );
      })()}

      {/* People */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...(data?.team ?? [])].sort(byPerson).map((name) => {
          const mine = all.filter((t) => t.assignee === name);
          const open = mine.filter((t) => !isDone(t.status));
          const active = open.filter((t) => /progress|revision/.test(t.status));
          const blocked = open.filter((t) => /block/.test(t.status));
          const working = data?.running.find((r) => r.person === name);
          // The task the timer button is for: the one being timed, else the first in progress, else the next open one
          const current = working ? all.find((t) => t.id === working.task_id) : (active[0] ?? open[0]);
          const p = perf.get(name);
          const on = person === name;
          return (
            <div
              key={name}
              role="button"
              tabIndex={0}
              onClick={() => setPerson(on ? null : name)}
              onKeyDown={(e) => e.key === "Enter" && setPerson(on ? null : name)}
              className={`card cursor-pointer p-5 text-left transition ${on ? "!border-[#171717]" : "hover:border-[var(--line-2)]"} ${person && !on ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <Avatar name={name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] font-medium">{name}</div>
                  <div className="text-[13px] text-[var(--muted)]">
                    {open.length} open · {active.length} active
                  </div>
                </div>
                {blocked.length > 0 && <Pill tone="red">{blocked.length} blocked</Pill>}
              </div>
              <div className="mt-4 truncate text-[14px] text-[var(--ink-2)]">
                {working ? <span className="text-[var(--green)]">● {working.task_title}</span> : active[0] ? active[0].title : blocked.length ? "Blocked" : "Nothing in progress"}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[13px] text-[var(--muted)]">
                <span className="tnum">{liveFor(name, p?.trackedToday ?? 0) >= 1 ? `${hm(Math.round(liveFor(name, p?.trackedToday ?? 0)))} today` : "No time today"}</span>
                {current && (data?.timersOn || working) && <TimerButton taskId={current.id} assignee={name} running={working} now={now} onChanged={reload} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,24%)]">
        <div className="min-w-0 space-y-10">
          {/* Tasks */}
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13.5px] font-semibold">
                {project ?? (person ? `${person}'s tasks` : "All tasks")} <span className="tnum font-normal text-[var(--muted)]">{tasks.length}</span>
                {(project || person) && (
                  <button className="ml-2 text-[12px] font-normal text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => (setProject(null), setPerson(null))}>
                    clear
                  </button>
                )}
              </h2>
              <div className="flex flex-wrap items-center gap-1">
                {FILTERS.map((x) => (
                  <button key={x} onClick={() => setF(x)} className={`rounded-full px-3 py-1 text-[12.5px] ${f === x ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-white"}`}>
                    {x}
                    {x !== "All" && (
                      <span className={`tnum ml-1 ${f === x ? "text-white/70" : "text-[var(--muted)]"}`}>
                        {all.filter((t) => (!person || t.assignee === person) && (!project || t.project === project) && (!prio || (t.priority ?? "normal") === prio) && bucket(t.status) === x).length}
                      </span>
                    )}
                  </button>
                ))}
                <span className="ml-1 flex flex-wrap items-center gap-1">
                  <Dropdown label="Person" align="right" value={person ?? ""} onChange={(v) => setPerson(v || null)} options={[{ value: "", label: "Everyone" }, ...[...(data?.team ?? [])].sort(byPerson).map((p) => ({ value: p, label: p }))]} />
                  <Dropdown label="Priority" align="right" value={prio} onChange={setPrio} options={PRIORITY_OPTIONS} />
                  <Dropdown label="Sort" align="right" value={sort} onChange={setSort} options={Object.entries(SORTS).map(([k, v]) => ({ value: k, label: v.label }))} />
                </span>
              </div>
            </div>
            {project && <ProjectTime name={project} tasks={all.filter((t) => t.project === project)} trackedOf={trackedOf} targetOf={targetOf} />}
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-[var(--line)] text-[12px] text-[var(--muted)]">
                    {["Task", "Person", "Status", "Tracked / estimate", "Due", ""].map((h, i) => (
                      <th key={i} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const tracked = Math.round(trackedOf(t));
                    const e = data?.estimates[t.id];
                    const target = targetOf(t);
                    const over = target && tracked > target;
                    return (
                      <tr key={t.id} onClick={() => live && setOpenTask(t.id)} className={`border-b border-[var(--line)] last:border-0 hover:bg-[var(--bg)]/60 ${live ? "cursor-pointer" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{t.title}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--muted)]">
                            {t.priority && t.priority !== "normal" && <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill>}
                            {t.project}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <Avatar name={t.assignee} size={22} /> {t.assignee}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {live ? <StatusSelect taskId={t.id} status={t.status} onChanged={reload} /> : <Pill>{t.status}</Pill>}
                          {(() => {
                            // How long it has been in this status, and where its time went before
                            const s = data?.inStatus?.[t.id];
                            if (!s || s.status !== t.status) return null;
                            const before = Object.entries(s.spent).filter(([, m]) => m >= 1).sort((a, b) => b[1] - a[1]);
                            return (
                              <div className="tnum mt-1 whitespace-nowrap text-[11.5px] text-[var(--muted)]" title={before.length ? `Before: ${before.map(([st, m]) => `${st} ${dur(m)}`).join(" · ")}` : undefined}>
                                for {dur((now - s.since) / 60000)}
                                {before.length > 0 && ` · ${before.length} earlier`}
                              </div>
                            );
                          })()}
                        </td>
                        <td className={`tnum whitespace-nowrap px-4 py-3 ${over ? "text-[var(--red)]" : ""}`}>
                          {hm(tracked)}
                          {target ? (
                            <span className="text-[var(--muted)]">
                              {" "}
                              / {hm(target)}
                              {e?.my_min ? "" : e?.ai_min ? <span title={e.ai_note ?? "Gemini's estimate"} className="ml-1 rounded bg-[var(--bg)] px-1 text-[10.5px]">AI</span> : ""}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--ink-2)]">{t.due ?? "—"}</td>
                        <td className="px-4 py-3 text-right">{live && (!isDone(t.status) || runningFor(t.id)) && <TimerButton taskId={t.id} assignee={t.assignee} running={runningFor(t.id)} now={now} onChanged={reload} savedMin={data?.tracked[t.id] ?? 0} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!tasks.length && <div className="p-10 text-center text-[var(--muted)]">{data ? "No tasks here" : "Loading…"}</div>}
            </div>
          </div>

          {/* Performance */}
          {data && data.performance.length > 0 && (
            <div>
              <h2 className="mb-1 text-[13.5px] font-semibold">Performance</h2>
              <p className="mb-3 text-[12.5px] text-[var(--muted)]">Time comes from GAC Desk timers (server clock). Accuracy compares tracked time on finished tasks with your estimate. On time = finished by the due date.</p>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-[12px] text-[var(--muted)]">
                      {["Person", "Open", "Done (week)", "Today", "This week", "Vs your estimate", "On time"].map((h) => (
                        <th key={h} className="px-4 py-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {data.performance.map((p) => (
                      <tr key={p.person} className="border-b border-[var(--line)] last:border-0">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <Avatar name={p.person} size={22} /> {p.person}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">{p.open}</td>
                        <td className="px-4 py-2.5">
                          {p.done} <span className="text-[var(--muted)]">({p.doneThisWeek})</span>
                        </td>
                        <td className="px-4 py-2.5">{hm(Math.round(liveFor(p.person, p.trackedToday)))}</td>
                        <td className="px-4 py-2.5">{hm(Math.round(liveFor(p.person, p.trackedWeek)))}</td>
                        <td className="px-4 py-2.5">
                          {p.accuracy ? (
                            <span className={p.accuracy.ratio > 1.2 ? "text-[var(--red)]" : p.accuracy.ratio < 0.8 ? "text-[var(--green)]" : ""}>
                              {Math.round(p.accuracy.ratio * 100)}% <span className="text-[var(--muted)]">· {p.accuracy.tasks} tasks</span>
                            </span>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {p.onTime ? (
                            <>
                              {Math.round(p.onTime.rate * 100)}% <span className="text-[var(--muted)]">· {p.onTime.tasks}</span>
                            </>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-10">
          {/* Projects | Team performance */}
          <div>
            <div className="mb-3 flex gap-1 rounded-xl bg-[var(--hover)] p-1">
              {(
                [
                  ["projects", `Current projects · ${current.length}`],
                  ["performance", "Team performance"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} onClick={() => setSide(k)} className={`flex-1 rounded-lg px-2 py-1.5 text-[12.5px] font-medium ${side === k ? "bg-white text-[var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-[var(--ink-2)]"}`}>
                  {label}
                </button>
              ))}
            </div>
            {side === "performance" && data && <TeamBars tasks={all} people={data.team} perf={perf} onPick={(p) => (setPerson(p), setProject(null))} />}
            {side === "projects" && (
            <>
            <div className="space-y-0.5">
              {current.map((p) => {
                const open = all.filter((t) => t.project === p.name && !isDone(t.status)).length;
                return (
                  <button key={p.id} onClick={() => setProject(project === p.name ? null : p.name)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${project === p.name ? "bg-white shadow-[0_0_0_1px_var(--line)]" : "hover:bg-white"}`}>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.owner && <span className="truncate text-[11.5px] capitalize text-[var(--muted)]">{p.owner}</span>}
                    <span className="tnum w-6 text-right text-[12px] text-[var(--ink-2)]">{open}</span>
                  </button>
                );
              })}
            </div>
            {otherStages.length > 0 && (
              <div className="mt-6 space-y-1 text-[12.5px] text-[var(--muted)]">
                {otherStages.map((s) => (
                  <div key={s}>
                    {s}: {(data?.projectInfo ?? []).filter((p) => p.stage === s).length} projects
                  </div>
                ))}
              </div>
            )}
            </>
            )}
          </div>

          {/* Status changes */}
          {data && (
            <div>
              <h2 className="mb-3 text-[13.5px] font-semibold">Status changes</h2>
              <div className="space-y-2.5">
                {data.changes.map((c, i) => (
                  <button key={i} className="block w-full text-left text-[12.5px] leading-snug" onClick={() => setOpenTask(c.task_id)}>
                    <div className="truncate font-medium text-[var(--ink)]">{c.task_title ?? all.find((t) => t.id === c.task_id)?.title ?? c.task_id}</div>
                    <div className="text-[var(--muted)]">
                      {c.from_status ?? "?"} → <span className="text-[var(--ink-2)]">{c.to_status}</span> · {c.person ?? "someone"} · {c.source === "clickup" ? "in ClickUp" : c.source === "timer" ? "timer" : "here"} · {ago(c.at)}
                    </div>
                  </button>
                ))}
                {!data.changes.length && <p className="text-[12.5px] text-[var(--muted)]">None yet. Changes made in ClickUp show up here once the webhook is registered.</p>}
              </div>
            </div>
          )}
        </aside>
      </div>

      {openTask && data && <TaskPanel id={openTask} data={data} now={now} onClose={() => setOpenTask(null)} reload={reload} />}
    </div>
  );
}
