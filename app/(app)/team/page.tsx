"use client";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, PlayCircle, RotateCw, Sparkles, X } from "lucide-react";
import type { Board } from "@/lib/clickup";
import { api } from "@/components/Live";
import { Avatar, Pill, ago } from "@/components/ui";
import { TeamSkeleton } from "@/components/Skeleton";
import { EstimateBox, StatusSelect, TimerButton, clock, hm, useTick, type Estimate, type RunningTimer } from "@/components/TaskControls";

const FILTERS = ["Open", "In progress", "Blocked", "Done", "All"] as const;
const isDone = (s: string) => /complete|done|closed/.test(s);
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
                <TimerButton taskId={d.id} assignee={d.assignee} running={running} now={now} onChanged={refresh} />
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
                      ...history.map((h) => ({ at: h.at, text: `${h.person ?? "Someone"}: ${h.from_status ?? "?"} → ${h.to_status} (${h.source})` })),
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
                <div className="eyebrow mb-2">Updates from the team · {d.comments.length}</div>
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

export default function Team() {
  const [data, setData] = useState<TeamData | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [f, setF] = useState<(typeof FILTERS)[number]>("Open");
  const [loading, setLoading] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const now = useTick(data?.now);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setData(await api<TeamData>(`/api/team${refresh ? "?refresh=1" : ""}`));
    } finally {
      setLoading(false);
    }
  }, []);
  // Status changes already clear the server's ClickUp cache, so a plain reload is enough
  const reload = useCallback(() => load(), [load]);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const all = data?.tasks ?? [];
  const live = data?.source === "clickup";
  const tasks = all
    .filter((t) => (!person || t.assignee === person) && (!project || t.project === project))
    .filter((t) => (f === "All" ? true : f === "Done" ? isDone(t.status) : f === "Open" ? !isDone(t.status) : f === "Blocked" ? /block/.test(t.status) : /progress|revision/.test(t.status)));
  const current = (data?.projectInfo ?? []).filter((p) => p.current);
  const otherStages = [...new Set((data?.projectInfo ?? []).filter((p) => !p.current).map((p) => p.stage))];
  const runningFor = (taskId: string) => data?.running.find((r) => r.task_id === taskId);
  const perf = new Map((data?.performance ?? []).map((p) => [p.person, p]));

  return (
    <div className="fade-in mx-auto max-w-[1240px] px-6 pb-20 pt-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-[15px] text-[var(--ink-2)]">
            {live ? `Live from ClickUp · ${current.length} current projects · ${all.filter((t) => !isDone(t.status)).length} open tasks` : "Test data. Add CLICKUP_TOKEN to .env to load your real tasks."}
            {data?.error && <span className="text-[var(--red)]"> ClickUp error: {data.error}</span>}
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => load(true)} disabled={loading}>
          <RotateCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {!data && <TeamSkeleton />}

      {/* Working now */}
      {data && data.running.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-[13.5px] font-semibold">
            Working now <span className="tnum font-normal text-[var(--muted)]">{data.running.length}</span>
          </h2>
          <div className="card divide-y divide-[var(--line)]">
            {data.running.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13.5px]">
                <span className="dot" style={{ background: "var(--green)" }} />
                <Avatar name={r.person} size={24} />
                <span className="w-[120px] shrink-0 truncate font-medium">{r.person}</span>
                <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setOpenTask(r.task_id)}>
                  {r.task_title} <span className="text-[var(--muted)]">· {r.project}</span>
                </button>
                <TimerButton taskId={r.task_id} assignee={r.person} running={r} now={now} onChanged={reload} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* People */}
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {(data?.team ?? []).map((name) => {
          const mine = all.filter((t) => t.assignee === name);
          const open = mine.filter((t) => !isDone(t.status));
          const active = open.filter((t) => /progress|revision/.test(t.status));
          const blocked = open.filter((t) => /block/.test(t.status));
          const working = data?.running.find((r) => r.person === name);
          const p = perf.get(name);
          const on = person === name;
          return (
            <button key={name} onClick={() => setPerson(on ? null : name)} className={`card p-4 text-left transition ${on ? "!border-[#171717]" : "hover:border-[var(--line-2)]"} ${person && !on ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-2.5">
                <Avatar name={name} size={30} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium">{name}</div>
                  <div className="text-[12px] text-[var(--muted)]">{open.length} open · {active.length} active</div>
                </div>
              </div>
              <div className="mt-3 truncate text-[12.5px] text-[var(--ink-2)]">
                {working ? <span className="text-[var(--green)]">● {working.task_title}</span> : active[0] ? active[0].title : blocked.length ? "Blocked" : "Nothing in progress"}
              </div>
              <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--muted)]">
                <span className="tnum">{p?.trackedToday ? `${hm(p.trackedToday)} today` : "No time today"}</span>
                {blocked.length > 0 && <Pill tone="red">{blocked.length} blocked</Pill>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
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
              <div className="flex gap-1">
                {FILTERS.map((x) => (
                  <button key={x} onClick={() => setF(x)} className={`rounded-full px-3 py-1 text-[12.5px] ${f === x ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-white"}`}>
                    {x}
                  </button>
                ))}
              </div>
            </div>
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
                    const tracked = (data?.tracked[t.id] ?? 0) || t.spentMin;
                    const e = data?.estimates[t.id];
                    const target = e?.my_min ?? t.estimateMin ?? e?.ai_min ?? null;
                    const over = target && tracked > target;
                    return (
                      <tr key={t.id} onClick={() => live && setOpenTask(t.id)} className={`border-b border-[var(--line)] last:border-0 hover:bg-[var(--bg)]/60 ${live ? "cursor-pointer" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{t.title}</div>
                          <div className="text-[12px] text-[var(--muted)]">{t.project}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <Avatar name={t.assignee} size={22} /> {t.assignee.split(" ")[0]}
                          </span>
                        </td>
                        <td className="px-4 py-3">{live ? <StatusSelect taskId={t.id} status={t.status} onChanged={reload} /> : <Pill>{t.status}</Pill>}</td>
                        <td className={`tnum whitespace-nowrap px-4 py-3 ${over ? "text-[var(--red)]" : ""}`}>
                          {hm(tracked)}
                          {target ? (
                            <span className="text-[var(--muted)]">
                              {" "}
                              / {hm(target)}
                              {e?.my_min ? "" : e?.ai_min && !t.estimateMin ? " AI" : ""}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--ink-2)]">{t.due ?? "—"}</td>
                        <td className="px-4 py-3 text-right">{live && !isDone(t.status) && <TimerButton taskId={t.id} assignee={t.assignee} running={runningFor(t.id)} now={now} onChanged={reload} />}</td>
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
                        <td className="px-4 py-2.5">{hm(p.trackedToday)}</td>
                        <td className="px-4 py-2.5">{hm(p.trackedWeek)}</td>
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
          {/* Projects */}
          <div>
            <h2 className="mb-3 text-[13.5px] font-semibold">
              Current projects <span className="tnum font-normal text-[var(--muted)]">{current.length}</span>
            </h2>
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
