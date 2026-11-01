"use client";
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, PlayCircle, RotateCw, X } from "lucide-react";
import type { Board } from "@/lib/clickup";
import { api } from "@/components/Live";
import { Avatar, Pill, STATUS_TONE, ago } from "@/components/ui";
import { TeamSkeleton } from "@/components/Skeleton";

const FILTERS = ["Open", "In progress", "Blocked", "Done", "All"] as const;
const hm = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "—");
const isDone = (s: string) => /complete|done|closed/.test(s);

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

function TaskPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setD(null);
    api<Detail>(`/api/tasks/${id}`).then(setD).catch((e) => setErr(e.message));
  }, [id]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/15" onClick={onClose}>
      <aside className="slide-in flex h-full w-[520px] max-w-full flex-col border-l border-[var(--line)] bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-5">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold leading-snug">{d?.title ?? "Loading…"}</div>
            {d && <div className="mt-1 text-[12.5px] text-[var(--muted)]">{d.project} · {d.stage} · {d.assignee}</div>}
          </div>
          <button className="btn btn-ghost !h-8 !w-8 shrink-0 !p-0" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="scroll flex-1 space-y-6 px-6 pb-8">
          {err && <p className="text-[var(--red)]">{err}</p>}
          {!d && !err && <Loader2 className="animate-spin text-[var(--muted)]" size={18} />}
          {d && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={STATUS_TONE(d.status)}>{d.status}</Pill>
                {d.url && (
                  <a href={d.url} target="_blank" className="btn btn-sm btn-ghost">
                    Open in ClickUp <ExternalLink size={12} />
                  </a>
                )}
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
  const [board, setBoard] = useState<Board | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [f, setF] = useState<(typeof FILTERS)[number]>("Open");
  const [loading, setLoading] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);

  async function load(refresh = false) {
    setLoading(true);
    try {
      setBoard(await api<Board>(`/api/team${refresh ? "?refresh=1" : ""}`));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const all = board?.tasks ?? [];
  const tasks = all
    .filter((t) => (!person || t.assignee === person) && (!project || t.project === project))
    .filter((t) => (f === "All" ? true : f === "Done" ? isDone(t.status) : f === "Open" ? !isDone(t.status) : f === "Blocked" ? /block/.test(t.status) : /progress|revision/.test(t.status)));
  const current = (board?.projectInfo ?? []).filter((p) => p.current);
  const otherStages = [...new Set((board?.projectInfo ?? []).filter((p) => !p.current).map((p) => p.stage))];

  return (
    <div className="fade-in mx-auto max-w-[1240px] px-6 pb-20 pt-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-[15px] text-[var(--ink-2)]">
            {board?.source === "clickup" ? `Live from ClickUp · ${current.length} current projects · ${all.filter((t) => !isDone(t.status)).length} open tasks` : "Test data. Add CLICKUP_TOKEN to .env to load your real tasks."}
            {board?.error && <span className="text-[var(--red)]"> ClickUp error: {board.error}</span>}
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => load(true)} disabled={loading}>
          <RotateCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {!board && <TeamSkeleton />}

      {/* People */}
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {(board?.team ?? []).map((name) => {
          const mine = all.filter((t) => t.assignee === name);
          const open = mine.filter((t) => !isDone(t.status));
          const active = open.filter((t) => /progress|revision/.test(t.status));
          const blocked = open.filter((t) => /block/.test(t.status));
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
              <div className="mt-3 truncate text-[12.5px] text-[var(--ink-2)]">{active[0] ? active[0].title : blocked.length ? "Blocked" : "Nothing in progress"}</div>
              <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--muted)]">
                <span>{open.some((t) => t.spentMin) ? `${hm(open.reduce((s, t) => s + t.spentMin, 0))} logged` : "No time logged"}</span>
                {blocked.length > 0 && <Pill tone="red">{blocked.length} blocked</Pill>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
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
            <table className="w-full min-w-[700px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-[var(--line)] text-[12px] text-[var(--muted)]">
                  {["Task", "Person", "Status", "Time", "Due"].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const over = t.estimateMin && t.spentMin > t.estimateMin;
                  return (
                    <tr key={t.id} onClick={() => board?.source === "clickup" && setOpenTask(t.id)} className={`border-b border-[var(--line)] last:border-0 hover:bg-[var(--bg)]/60 ${board?.source === "clickup" ? "cursor-pointer" : ""}`}>
                      <td className="px-5 py-3">
                        <div className="font-medium">{t.title}</div>
                        <div className="text-[12px] text-[var(--muted)]">{t.project}</div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <Avatar name={t.assignee} size={22} /> {t.assignee.split(" ")[0]}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <Pill tone={STATUS_TONE(t.status)}>{t.status}</Pill>
                      </td>
                      <td className={`tnum whitespace-nowrap px-5 py-3 ${over ? "text-[var(--red)]" : ""}`}>
                        {hm(t.spentMin)}
                        {t.estimateMin ? <span className="text-[var(--muted)]"> / {hm(t.estimateMin)}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-[var(--ink-2)]">{t.due ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!tasks.length && <div className="p-10 text-center text-[var(--muted)]">{board ? "No tasks here" : "Loading…"}</div>}
          </div>
        </div>

        {/* Projects */}
        <aside>
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
                  {s}: {(board?.projectInfo ?? []).filter((p) => p.stage === s).length} projects
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {openTask && <TaskPanel id={openTask} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
