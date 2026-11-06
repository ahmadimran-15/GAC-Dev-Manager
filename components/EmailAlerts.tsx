"use client";
import { useEffect, useState } from "react";
import { api, useLive } from "@/components/Live";

// The WhatsApp ping for each new email. Lives in the database, not .env, so it can be switched off
// from here without a redeploy — which is what you want at the moment it starts being a nuisance.
export default function EmailAlerts() {
  const { toast } = useLive();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ on: boolean }>("/api/alerts")
      .then((r) => setOn(r.on))
      .catch(() => setOn(null));
  }, []);

  const flip = async () => {
    setBusy(true);
    try {
      const r = await api<{ on: boolean }>("/api/alerts", { on: !on });
      setOn(r.on);
      toast(r.on ? "You'll get a WhatsApp for each new email" : "WhatsApp pings for new email are off");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-4 py-4">
      <span className="dot mt-2" style={{ background: on === null ? "#cfcfca" : on ? "var(--green)" : "#cfcfca" }} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">A WhatsApp when an email arrives</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--ink-2)]">
          {on === null
            ? "Loading…"
            : on
              ? "On. Each new client email sends you a WhatsApp. Newsletters and receipts filed under Updates never do."
              : "Off. Email still arrives in the inbox; your phone just stays quiet."}
        </div>
        <button className="btn btn-sm mt-2" disabled={busy || on === null} onClick={flip}>
          {on ? "Turn it off" : "Turn it on"}
        </button>
      </div>
    </div>
  );
}
