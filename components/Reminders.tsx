"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, X } from "lucide-react";
import { useLive } from "@/components/Live";
import WaitingCard from "@/components/WaitingCard";
import { mins } from "@/components/ui";

const LS = { every: "gac_remind_every", after: "gac_remind_after", snooze: "gac_snooze" };
const read = (k: string, d: number) => {
  try {
    return Number(localStorage.getItem(k) ?? d) || d;
  } catch {
    return d;
  }
};
const snoozes = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(LS.snooze) ?? "{}");
  } catch {
    return {};
  }
};

export const reminderSettings = {
  get: () => ({ every: read(LS.every, 5), after: read(LS.after, 2) }),
  set: (every: number, after: number) => {
    try {
      localStorage.setItem(LS.every, String(every));
      localStorage.setItem(LS.after, String(after));
    } catch {}
  },
};

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.16);
      o.stop(ctx.currentTime + i * 0.16 + 0.32);
    });
  } catch {}
}

// Every few minutes, if clients are still waiting, this pops up with each one and a ready reply.
export default function Reminders() {
  const { state } = useLive();
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const lastShown = useRef(0);
  const now = state?.now ?? Date.now();

  const { after } = typeof window === "undefined" ? { after: 2 } : reminderSettings.get();
  const snoozed = typeof window === "undefined" ? {} : snoozes();
  const due = (state?.conversations ?? []).filter((c) => c.waiting && c.waitingSince && mins(c.waitingSince, now) >= after && !(snoozed[c.id] > Date.now()));

  useEffect(() => {
    const check = () => {
      const { every } = reminderSettings.get();
      if (!due.length || Date.now() - lastShown.current < every * 60_000) return;
      lastShown.current = Date.now();
      setOpen(true);
      chime();
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        const first = due[0];
        new Notification(`${due.length} client${due.length > 1 ? "s" : ""} waiting for your reply`, {
          body: `${first.name}: ${first.last?.text?.slice(0, 80) ?? ""}`,
          tag: "gac-reminder",
        });
      }
    };
    // first reminder shortly after opening the dashboard, then on the chosen interval
    if (!lastShown.current && due.length) lastShown.current = Date.now() - reminderSettings.get().every * 60_000 + 15_000;
    check();
    const id = setInterval(check, 20_000);
    return () => clearInterval(id);
  }, [due.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Instant alert when a new client message arrives (any channel)
  const seen = useRef<Map<string, number> | null>(null);
  const { toast } = useLive();
  useEffect(() => {
    if (!state) return;
    const incoming = state.conversations.filter((c) => c.last && c.last.direction === "in");
    if (!seen.current) {
      seen.current = new Map(incoming.map((c) => [c.id, c.last!.at]));
      return;
    }
    const fresh = incoming.filter((c) => (seen.current!.get(c.id) ?? 0) < c.last!.at);
    for (const c of incoming) seen.current.set(c.id, c.last!.at);
    if (!fresh.length) return;
    chime();
    toast(`New message from ${fresh.map((c) => c.name).join(", ")}`);
    if ("Notification" in window && Notification.permission === "granted") {
      for (const c of fresh.slice(0, 3)) new Notification(`New message from ${c.name}`, { body: c.last?.text?.slice(0, 120) ?? "", tag: `gac-${c.id}` });
    }
  }, [state?.now]); // eslint-disable-line react-hooks/exhaustive-deps

  function snooze(id: string) {
    const s = snoozes();
    s[id] = Date.now() + 30 * 60_000;
    try {
      localStorage.setItem(LS.snooze, JSON.stringify(s));
    } catch {}
    force((x) => x + 1);
  }

  return (
    <>
      <button
        className={`btn btn-ghost relative !h-9 !w-9 !p-0 ${due.length ? "text-[var(--ink)]" : ""}`}
        onClick={() => {
          setOpen((o) => !o);
          if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
        }}
        title="Pending replies"
      >
        {due.length ? <BellRing size={18} /> : <Bell size={18} />}
        {due.length > 0 && <span className="tnum absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-[var(--red)] px-1 text-center text-[10px] font-semibold leading-4 text-white">{due.length}</span>}
      </button>

      {open && (
        <div className="slide-in fixed right-4 top-16 z-50 flex max-h-[calc(100vh-84px)] w-[440px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
            <div>
              <div className="font-semibold">{due.length ? `${due.length} client${due.length > 1 ? "s" : ""} still waiting` : "No one is waiting"}</div>
              <div className="text-[12.5px] text-[var(--muted)]">Replies are drafted. Check, then send.</div>
            </div>
            <button className="btn btn-ghost !h-8 !w-8 !p-0" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="scroll divide-y divide-[var(--line)] px-5">
            {due.map((c) => (
              <div key={c.id} className="relative">
                <WaitingCard c={c} now={now} compact />
                <div className="-mt-2 mb-3 text-right">
                  <button className="text-[12px] text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => snooze(c.id)}>
                    Remind me in 30 min
                  </button>
                </div>
              </div>
            ))}
            {!due.length && <div className="py-10 text-center text-[var(--muted)]">All caught up.</div>}
          </div>
        </div>
      )}
    </>
  );
}
