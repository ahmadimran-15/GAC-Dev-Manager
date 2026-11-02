"use client";
import { useEffect, useState } from "react";
import { api, useLive } from "@/components/Live";

interface Info {
  enabled: boolean;
  running: unknown[];
  shift: { start: string; end: string; label: string; on: boolean };
  unsent: { segments: number; minutes: number };
}

// Settings → Time tracking: the master switch and the shift hours. Clocks follow ClickUp: a task in progress or
// in revision is timed, any other status (waiting for approval, review, done…) stops it.
export default function TimeTrackingSettings() {
  const { toast } = useLive();
  const [info, setInfo] = useState<Info | null>(null);
  const [start, setStart] = useState("13:30");
  const [end, setEnd] = useState("22:30");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<Info>("/api/timers").then((r) => {
      setInfo(r);
      setStart(r.shift.start);
      setEnd(r.shift.end);
    });
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function toggle() {
    if (!info) return;
    const on = !info.enabled;
    if (!on && !confirm("Switch time tracking off? Every running timer stops and none start until you switch it on again.")) return;
    setBusy(true);
    try {
      await api("/api/timers", { action: "enabled", on });
      toast(on ? "Time tracking on: tasks in progress / revision are timed during the shift" : "Time tracking off");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveShift() {
    setBusy(true);
    try {
      await api("/api/timers", { action: "shift", start, end });
      toast("Shift hours saved");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  // Copies tracked time ClickUp hasn't got into its own Track time field
  async function pushTime() {
    setBusy(true);
    try {
      const r = await api<{ sent: number; minutes: number; failed: number; error: string | null }>("/api/timers", { action: "push-time" });
      toast(r.sent ? `Sent ${r.sent} entries (${Math.floor(r.minutes / 60)}h ${r.minutes % 60}m) to ClickUp${r.failed ? `, ${r.failed} failed` : ""}` : r.error ? `ClickUp refused it: ${r.error}` : "ClickUp already has everything");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ClickUp failed", "error");
    } finally {
      setBusy(false);
    }
  }

  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  return (
    <div className="card divide-y divide-[var(--line)] px-5">
      <div className="flex items-center gap-3 py-4">
        <span className="dot shrink-0" style={{ background: info?.enabled ? "var(--green)" : "#cfcfca" }} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">Time tracking {info ? (info.enabled ? "on" : "off") : ""}</div>
          <div className="text-[12.5px] text-[var(--ink-2)]">
            {info?.enabled
              ? `${info.running.length} timer${info.running.length === 1 ? "" : "s"} running${info.shift.on ? "" : " · outside the shift, paused"}`
              : "Nothing is timed. Switch on to time tasks while they're in progress or in revision."}
          </div>
        </div>
        <button className={`btn btn-sm ${info?.enabled ? "" : "btn-dark"}`} disabled={!info || busy} onClick={toggle}>
          {info?.enabled ? "Switch off" : "Switch on"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 py-4 text-[14px]">
        Shift from
        <input type="time" className="input !w-auto !py-1" value={start} onChange={(e) => setStart(e.target.value)} />
        to
        <input type="time" className="input !w-auto !py-1" value={end} onChange={(e) => setEnd(e.target.value)} />
        <span className="text-[12.5px] text-[var(--muted)]">Pakistan time, every day</span>
        <button className="btn btn-sm ml-auto" disabled={busy || !info || (start === info.shift.start && end === info.shift.end)} onClick={saveShift}>
          Save
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">Time in ClickUp</div>
          <div className="text-[12.5px] text-[var(--ink-2)]">
            {info
              ? info.unsent.segments
                ? `${hm(info.unsent.minutes)} tracked here hasn't reached ClickUp's Track time yet (${info.unsent.segments} entries).`
                : "ClickUp's Track time has everything tracked here."
              : ""}
          </div>
        </div>
        <button className={`btn btn-sm ${info?.unsent.segments ? "btn-dark" : ""}`} disabled={!info || busy || !info.unsent.segments} onClick={pushTime}>
          Send to ClickUp
        </button>
      </div>
      <div className="space-y-1 py-3 text-[12.5px] text-[var(--muted)]">
        <p>Every clock that stops is copied into the task&apos;s Track time in ClickUp. On ClickUp&apos;s Free plan every entry is booked under your own account, so a teammate&apos;s time says whose it was in its description.</p>
        <p>Clocks follow ClickUp: moving a task to in progress or revision starts its clock; any other status (waiting for approval, review, done…) stops it.</p>
        <p>At the end of the shift every clock stops; at the next start the same tasks resume if they're still in progress. Team page → Start all / Stop all, or Start / Stop on any task.</p>
      </div>
    </div>
  );
}
