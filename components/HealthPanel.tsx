"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RotateCw } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { ago } from "@/components/ui";

interface Check {
  key: string;
  group: string;
  name: string;
  ok: boolean | null;
  detail: string;
  action?: "wa-start" | "wa-qr" | "settings";
  accountId?: string;
  ms?: number;
}

// Every connection, checked on a timer and on demand, with a fix button where one exists.
export default function HealthPanel() {
  const { toast, refresh } = useLive();
  const [h, setH] = useState<{ at: number; checks: Check[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    api<{ at: number; checks: Check[] }>("/api/health").then(setH).catch(() => {});
  }, []);

  async function act(action: string, id?: string) {
    setBusy(action + (id ?? ""));
    try {
      if (action === "wa-qr") {
        const r = await api<{ qr: string }>("/api/health", { action, id });
        setQr(r.qr || "");
        if (!r.qr) toast("No QR code right now: the session may already be linked", "error");
      } else {
        const r = await api<{ at?: number; checks?: Check[]; health?: { at: number; checks: Check[] }; status?: string }>("/api/health", { action, id });
        setH(r.health ?? (r.checks ? { at: r.at!, checks: r.checks } : h));
        if (action === "wa-start") toast(`WhatsApp session: ${r.status}`);
        refresh();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy("");
    }
  }

  const problems = h?.checks.filter((c) => c.ok === false).length ?? 0;

  return (
    <div className="card px-5 py-2">
      <div className="flex items-center justify-between py-3">
        <div className="text-[13.5px]">
          {h ? (
            problems ? (
              <span className="font-medium text-[var(--red)]">
                {problems} connection{problems > 1 ? "s need" : " needs"} attention
              </span>
            ) : (
              <span className="font-medium text-[var(--green)]">Everything is working</span>
            )
          ) : (
            <span className="text-[var(--muted)]">Checking…</span>
          )}
          {h && <span className="text-[var(--muted)]"> · checked {ago(h.at)} · rechecks every 10 min</span>}
        </div>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => act("recheck")}>
          {busy === "recheck" ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} Check now
        </button>
      </div>
      <div className="divide-y divide-[var(--line)] pb-2">
        {h?.checks.map((c) => (
          <div key={c.key} className="flex items-start gap-3 py-2.5">
            <span className="dot mt-[7px]" style={{ background: c.ok === null ? "#cfcfca" : c.ok ? "var(--green)" : "var(--red)" }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px]">
                <span className="text-[var(--muted)]">{c.group} · </span>
                <span className="font-medium">{c.name}</span>
                {c.ms !== undefined && c.ok && <span className="tnum text-[11.5px] text-[var(--muted)]"> · {c.ms} ms</span>}
              </div>
              <div className={`text-[12.5px] ${c.ok === false ? "text-[var(--red)]" : "text-[var(--ink-2)]"}`}>{c.detail}</div>
            </div>
            {c.action === "wa-start" && (
              <button className="btn btn-sm shrink-0" disabled={!!busy} onClick={() => act("wa-start", c.accountId)}>
                {busy === `wa-start${c.accountId}` && <Loader2 size={13} className="animate-spin" />} Start session
              </button>
            )}
            {c.action === "wa-qr" && (
              <button className="btn btn-sm shrink-0" disabled={!!busy} onClick={() => act("wa-qr", c.accountId)}>
                Show QR code
              </button>
            )}
            {c.action === "settings" && (
              <Link href="#accounts" className="btn btn-sm btn-ghost shrink-0">
                Fix
              </Link>
            )}
          </div>
        ))}
      </div>
      {qr !== null && qr && (
        <div className="mb-3 flex flex-col items-center gap-2 rounded-xl bg-[var(--bg)] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.startsWith("data:") ? qr : `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`} alt="WhatsApp QR code" className="h-[220px] w-[220px] rounded-lg bg-white p-2" />
          <p className="text-[12.5px] text-[var(--ink-2)]">WhatsApp on your phone → Linked devices → Link a device, then scan.</p>
          <button className="btn btn-sm" onClick={() => (setQr(null), act("recheck"))}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
