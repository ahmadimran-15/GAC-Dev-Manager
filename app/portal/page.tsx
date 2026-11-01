"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, LogOut, Pause, Play, XCircle } from "lucide-react";
import { clock, hm, useTick } from "@/components/TaskControls";
import { Pill, STATUS_TONE } from "@/components/ui";

interface PTask {
  id: string;
  title: string;
  project: string;
  status: string;
  due: string | null;
  estimateMin: number | null;
  trackedMin: number;
  url?: string;
}

interface Info {
  now: number;
  me: { name: string; email: string; clickupName: string | null };
  projects: string[];
  clients: { id: string; label: string; project: string | null }[];
  mine: { id: string; text: string; project: string | null; status: string; created_at: number; conv_name: string | null }[];
  tasks: PTask[];
  running: { id: string; task_id: string; task_title: string; started_at: number } | null;
}

const when = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The only page a team member sees: write a client update for a project; the owner approves and sends it.
export default function Portal() {
  const [info, setInfo] = useState<Info | null>(null);
  const [project, setProject] = useState("");
  const [conv, setConv] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [timerBusy, setTimerBusy] = useState(false);
  const now = useTick(info?.now);

  const load = () =>
    fetch("/api/portal", { cache: "no-store" })
      .then((r) => (r.status === 401 ? (location.href = "/login") : r.json()))
      .then((d) => d && setInfo(d));

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, conv_id: conv, text }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      setText("");
      setMsg({ ok: true, text: "Sent for approval. You'll see it here once it goes out." });
      load();
    } else setMsg({ ok: false, text: d.error ?? "Failed" });
  }

  // Start (or switch to) a task, or stop the running one. Times come from the server clock.
  async function timer(body: { action: "start"; taskId: string } | { action: "stop" }) {
    setTimerBusy(true);
    const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setTimerBusy(false);
    if (!r.ok) setMsg({ ok: false, text: d.error ?? "Failed" });
    load();
  }

  async function changePassword() {
    const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "password", password: pw }) });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? { ok: true, text: "Password changed" } : { ok: false, text: d.error ?? "Failed" });
    if (r.ok) {
      setPw("");
      setShowPw(false);
    }
  }

  const clients = (info?.clients ?? []).filter((c) => !project || !c.project || c.project === project);

  return (
    <div className="mx-auto max-w-[640px] px-6 py-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#171717] text-[13px] font-bold text-white">G</span>
          <span className="font-semibold">GAC Desk</span>
        </div>
        <div className="flex items-center gap-1 text-[13px] text-[var(--ink-2)]">
          {info?.me.name}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPw((s) => !s)}>
            Password
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              location.href = "/login";
            }}
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      {showPw && (
        <div className="card mt-4 flex gap-2 p-3">
          <input className="input" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn btn-dark" disabled={pw.length < 8} onClick={changePassword}>
            Save
          </button>
        </div>
      )}

      {info?.me.clickupName && (
        <>
          <h1 className="mt-10 text-[26px] font-semibold tracking-tight">My tasks</h1>
          <p className="mt-1 text-[14.5px] text-[var(--ink-2)]">Press Start when you begin working on a task and Pause when you stop. Starting another task pauses the current one.</p>
          {info.running && (
            <div className="card mt-5 flex items-center gap-3 !border-[var(--green)] px-4 py-3">
              <span className="dot" style={{ background: "var(--green)" }} />
              <div className="min-w-0 flex-1 truncate text-[14px] font-medium">{info.running.task_title}</div>
              <span className="tnum text-[15px] font-semibold">{clock(info.running.started_at, now)}</span>
              <button className="btn btn-sm" disabled={timerBusy} onClick={() => timer({ action: "stop" })}>
                <Pause size={12} /> Pause
              </button>
            </div>
          )}
          <div className="card mt-3 divide-y divide-[var(--line)]">
            {info.tasks.map((t) => {
              const on = info.running?.task_id === t.id;
              // trackedMin already counts the running timer up to the last poll
              const tracked = t.trackedMin + (on ? Math.max(0, Math.floor((now - info.now) / 60000)) : 0);
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--muted)]">
                      <Pill tone={STATUS_TONE(t.status)}>{t.status}</Pill>
                      {t.project}
                      {t.due && <span>· due {t.due}</span>}
                      <span className="tnum">
                        · {hm(tracked)}
                        {t.estimateMin ? ` of ${hm(t.estimateMin)}` : ""}
                      </span>
                    </div>
                  </div>
                  <button className={`btn btn-sm ${on ? "!border-[var(--green)] !text-[var(--green)]" : ""}`} disabled={timerBusy} onClick={() => timer(on ? { action: "stop" } : { action: "start", taskId: t.id })}>
                    {on ? <Pause size={12} /> : <Play size={12} />} {on ? "Pause" : "Start"}
                  </button>
                </div>
              );
            })}
            {!info.tasks.length && <p className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">No open tasks assigned to you in ClickUp.</p>}
          </div>
        </>
      )}

      <h1 className="mt-10 text-[26px] font-semibold tracking-tight">Send a client update</h1>
      <p className="mt-1 text-[14.5px] text-[var(--ink-2)]">Write what the client should hear. Your manager checks it and sends it from the company account.</p>

      <div className="mt-6 space-y-3">
        <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Which project?</option>
          {info?.projects.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select className="input" value={conv} onChange={(e) => setConv(e.target.value)}>
          <option value="">Which client? (optional: your manager can choose)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.project ? ` · ${c.project}` : ""}
            </option>
          ))}
        </select>
        <textarea className="input min-h-[160px] leading-relaxed" dir="auto" placeholder="What's done, what's next, any question for the client…" value={text} onChange={(e) => setText(e.target.value)} />
        {msg && <p className={`text-[13.5px] ${msg.ok ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{msg.text}</p>}
        <button className="btn btn-dark !h-10 w-full" disabled={busy || !text.trim() || (!project && !conv)} onClick={submit}>
          {busy ? "Sending…" : "Send for approval"}
        </button>
      </div>

      <h2 className="mb-2 mt-12 text-[13.5px] font-semibold">Your updates</h2>
      <div className="card divide-y divide-[var(--line)]">
        {info?.mine.map((d) => (
          <div key={d.id} className="flex gap-3 px-4 py-3">
            {d.status === "approved" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--green)]" /> : d.status === "discarded" ? <XCircle size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" /> : <Clock size={16} className="mt-0.5 shrink-0 text-[var(--amber)]" />}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13.5px]">{d.text}</p>
              <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                {d.status === "approved" ? "Sent" : d.status === "discarded" ? "Not sent" : "Waiting for approval"} · {d.project ?? d.conv_name ?? ""} · {when(d.created_at)}
              </div>
            </div>
          </div>
        ))}
        {info && !info.mine.length && <p className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">Nothing yet.</p>}
      </div>
    </div>
  );
}
