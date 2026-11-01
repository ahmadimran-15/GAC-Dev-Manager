"use client";
import { useEffect, useState } from "react";
import { Loader2, Pause, Play, Sparkles } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { Pill, STATUS_TONE } from "@/components/ui";

export const hm = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "—");

// h:mm:ss since a moment, for running timers
export function clock(from: number, now: number) {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// A clock that ticks every second, aligned with the server's time
export function useTick(serverNow?: number) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (serverNow) setOffset(serverNow - Date.now());
  }, [serverNow]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now + offset;
}

// Status pill that turns into the list's statuses on click; saving writes to ClickUp straight away.
export function StatusSelect({ taskId, status, onChanged }: { taskId: string; status: string; onChanged?: (s: string) => void }) {
  const { toast } = useLive();
  const [opts, setOpts] = useState<{ status: string; color: string }[] | null>(null);
  const [cur, setCur] = useState(status);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCur(status), [status]);

  if (!opts)
    return (
      <button
        className="cursor-pointer"
        title="Change status"
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          try {
            setOpts((await api<{ options: { status: string; color: string }[] }>(`/api/tasks/${taskId}/status`)).options);
          } catch (err) {
            toast(err instanceof Error ? err.message : "Failed", "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Pill tone={STATUS_TONE(cur)}>
          {cur} {busy && <Loader2 size={10} className="animate-spin" />}
        </Pill>
      </button>
    );
  return (
    <select
      autoFocus
      className="input !h-7 !w-auto !py-0 !text-[12.5px] capitalize"
      value={cur}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => !busy && setOpts(null)}
      onChange={async (e) => {
        const to = e.target.value;
        setBusy(true);
        try {
          await api(`/api/tasks/${taskId}/status`, { status: to });
          setCur(to);
          toast(`Status → ${to} (saved in ClickUp)`);
          onChanged?.(to);
        } catch (err) {
          toast(err instanceof Error ? err.message : "Failed", "error");
        } finally {
          setBusy(false);
          setOpts(null);
        }
      }}
    >
      {opts.map((o) => (
        <option key={o.status} value={o.status}>
          {o.status}
        </option>
      ))}
    </select>
  );
}

export interface RunningTimer {
  id: string;
  task_id: string;
  task_title: string;
  project: string | null;
  person: string;
  started_at: number;
}

// Start / stop the timer for a task's assignee (one running timer per person)
export function TimerButton({ taskId, assignee, running, now, onChanged, startUrl = "/api/timers" }: { taskId: string; assignee: string; running?: RunningTimer; now: number; onChanged: () => void; startUrl?: string }) {
  const { toast } = useLive();
  const [busy, setBusy] = useState(false);
  if (assignee === "Unassigned" && !running) return null;
  return (
    <button
      className={`btn btn-sm whitespace-nowrap ${running ? "!border-[var(--green)] !text-[var(--green)]" : ""}`}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await api(startUrl, running ? { action: "stop", id: running.id } : { action: "start", taskId });
          toast(running ? `Stopped · ${clock(running.started_at, Date.now())}` : `Timer started for ${assignee}`);
          onChanged();
        } catch (err) {
          toast(err instanceof Error ? err.message : "Failed", "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {running ? <Pause size={12} /> : <Play size={12} />}
      <span className="tnum">{running ? clock(running.started_at, now) : "Start"}</span>
    </button>
  );
}

export interface Estimate {
  task_id: string;
  my_min: number | null;
  ai_min: number | null;
  ai_note: string | null;
}

// Your private estimate and Gemini's projection (never written to ClickUp, never shown to the team)
export function EstimateBox({ taskId, initial, tracked, onSaved }: { taskId: string; initial?: Estimate; tracked: number; onSaved?: () => void }) {
  const { toast } = useLive();
  const [e, setE] = useState<Estimate | undefined>(initial);
  const [mine, setMine] = useState(initial?.my_min ? String(initial.my_min) : "");
  const [busy, setBusy] = useState<"" | "save" | "ai">("");
  useEffect(() => {
    api<Estimate>(`/api/tasks/${taskId}/estimate`).then((r) => {
      setE(r);
      setMine(r.my_min ? String(r.my_min) : "");
    });
  }, [taskId]);

  async function post(body: unknown, kind: "save" | "ai") {
    setBusy(kind);
    try {
      const r = await api<Estimate>(`/api/tasks/${taskId}/estimate`, body);
      setE(r);
      setMine(r.my_min ? String(r.my_min) : "");
      toast(kind === "ai" ? "AI projection ready" : "Estimate saved");
      onSaved?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy("");
    }
  }

  const pct = e?.my_min && tracked ? Math.round((tracked / e.my_min) * 100) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <span className="w-[110px] text-[var(--ink-2)]">Your estimate</span>
        <input className="input !h-8 !w-[90px] !py-0" inputMode="numeric" placeholder="minutes" value={mine} onChange={(x) => setMine(x.target.value.replace(/[^\d]/g, ""))} />
        <span className="text-[12px] text-[var(--muted)]">{mine ? hm(Number(mine)) : "min"}</span>
        <button className="btn btn-sm" disabled={!!busy || String(e?.my_min ?? "") === mine} onClick={() => post({ myMin: mine ? Number(mine) : null }, "save")}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="flex flex-wrap items-start gap-2 text-[13.5px]">
        <span className="w-[110px] pt-1 text-[var(--ink-2)]">AI projection</span>
        <div className="min-w-0 flex-1">
          {e?.ai_min ? (
            <>
              <b className="tnum font-medium">{hm(e.ai_min)}</b>
              {e.ai_note && <p className="text-[12.5px] text-[var(--muted)]">{e.ai_note}</p>}
            </>
          ) : (
            <span className="text-[var(--muted)]">Not asked yet</span>
          )}
        </div>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => post({ ai: true }, "ai")}>
          <Sparkles size={12} /> {busy === "ai" ? "Thinking…" : e?.ai_min ? "Redo" : "Project"}
        </button>
      </div>
      <div className="flex items-center gap-2 text-[13.5px]">
        <span className="w-[110px] text-[var(--ink-2)]">Tracked</span>
        <b className={`tnum font-medium ${pct && pct > 100 ? "text-[var(--red)]" : ""}`}>{hm(tracked)}</b>
        {pct !== null && <span className="text-[12px] text-[var(--muted)]">{pct}% of your estimate</span>}
      </div>
    </div>
  );
}
