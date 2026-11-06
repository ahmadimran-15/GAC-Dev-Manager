"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import TeamNav, { type TeamCan } from "@/components/TeamNav";

export const dynamic = "force-dynamic";

interface Task {
  id: string;
  title: string;
  project: string;
  status: string;
}

// A dropdown you can type in: with 37 projects and 200 tasks, scrolling a plain list is hopeless.
function Picker({ label, value, options, onPick, disabled, empty }: { label: string; value: string; options: { value: string; label: string }[]; onPick: (v: string) => void; disabled?: boolean; empty: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <label className="eyebrow mb-1.5 block">{label}</label>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={`input flex items-center gap-2 text-left disabled:opacity-60 ${open ? "!border-[#a8a8a2]" : ""}`}>
        <span className={`min-w-0 flex-1 truncate ${current ? "" : "text-[var(--muted)]"}`}>{current?.label ?? empty}</span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--ink-2)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.22)]">
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
            <Search size={13} className="shrink-0 text-[var(--muted)]" />
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted)]"
              placeholder={`Search ${options.length}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0]) {
                  onPick(shown[0].value);
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto p-1">
            {shown.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onPick(o.value);
                  setOpen(false);
                }}
                className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] ${o.value === value ? "bg-[var(--bg)] font-medium" : "hover:bg-[var(--bg)]"}`}
              >
                {o.label}
              </button>
            ))}
            {!shown.length && <p className="px-2.5 py-3 text-[13px] text-[var(--muted)]">Nothing with that name</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// Public update form: no login. Pick the project, pick the task, write the update, send it for approval.
// Nothing about clients is shown here — only project and task names.
export default function UpdateForm() {
  const [data, setData] = useState<{ me: { name: string }; can: TeamCan; projects: string[]; tasks: Task[] } | null>(null);
  const [project, setProject] = useState("");
  const [taskId, setTaskId] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [statuses, setStatuses] = useState<{ status: string; color: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/form", { cache: "no-store" })
      .then((r) => (r.status === 401 ? ((location.href = "/login?next=/form"), null) : r.json()))
      .then((d) => d && setData(d))
      .catch(() => setMsg({ ok: false, text: "Couldn't load the projects. Refresh the page." }));
  }, []);

  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) => t.project === project), [data, project]);
  const current = useMemo(() => tasks.find((t) => t.id === taskId)?.status ?? "", [tasks, taskId]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/form", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, taskId, text, status }) });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error ?? "Couldn't send it");
      setMsg({ ok: true, text: "Sent for approval. Once the manager approves it, it goes on the task in ClickUp." });
      setText("");
      setTaskId("");
      setStatus("");
      setStatuses(null);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't send it" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-10 md:px-6">
      <TeamNav name={data?.me.name} can={data?.can ?? { form: true, portal: false }} active="form" />

      <h1 className="text-[28px] font-semibold tracking-tight">Send an update</h1>
      <p className="mt-1 text-[14.5px] text-[var(--ink-2)]">
        Pick the project and the task, write your update, and send it. The manager checks it, then it goes on that task in ClickUp under your name.
      </p>

      <div className="mt-7 space-y-3">
        <Picker
          label="Project"
          value={project}
          empty="Search or pick a project"
          options={(data?.projects ?? []).map((p) => ({ value: p, label: p }))}
          onPick={(v) => {
            setProject(v);
            setTaskId("");
          }}
        />

        <Picker
          label="Task"
          value={taskId}
          disabled={!project}
          empty={project ? `Search or pick a task (${tasks.length})` : "Pick the project first"}
          options={tasks.map((t) => ({ value: t.id, label: t.title }))}
          onPick={(v) => {
            setTaskId(v);
            setStatus("");
            setStatuses(null);
            // The statuses this task can move to come from its own ClickUp list, so they are
            // fetched once the task is picked rather than for all 200 tasks up front.
            fetch(`/api/form?task=${encodeURIComponent(v)}`, { cache: "no-store" })
              .then((r) => r.json())
              .then((d) => d?.options && setStatuses(d.options))
              .catch(() => setStatuses([]));
          }}
        />

        {taskId && (
          <div>
            <label className="eyebrow mb-1.5 block">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!statuses}>
              <option value="">Leave it as it is{current ? ` (${current})` : ""}</option>
              {(statuses ?? []).map((s) => (
                <option key={s.status} value={s.status}>
                  Ask to move to: {s.status}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {statuses ? "The manager sees this with your update and decides." : "Loading the statuses…"}
            </p>
          </div>
        )}

        <div>
          <label className="eyebrow mb-1.5 block">Update</label>
          <textarea
            className="input min-h-[170px] leading-relaxed"
            dir="auto"
            placeholder="What's done, what's left, anything blocking you…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
          />
        </div>

        {msg && <p className={`text-[13.5px] ${msg.ok ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{msg.text}</p>}

        <button className="btn btn-dark !h-11 w-full" disabled={busy || !taskId || !text.trim()} onClick={submit}>
          {busy ? "Sending…" : "Send for approval"}
        </button>
        <p className="text-center text-[12px] text-[var(--muted)]">{data ? `${data.tasks.length} open tasks across ${data.projects.length} projects` : "Loading projects…"}</p>
      </div>
    </div>
  );
}
