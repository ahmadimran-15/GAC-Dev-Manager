"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { ago } from "@/components/ui";

// Tokens another app uses to file team updates into the approval queue. Shown once, when made:
// after that only the last few characters, because the place for it is that app's configuration.

interface Row {
  id: string;
  name: string;
  tail: string;
  createdAt: number;
  lastUsed: number | null;
}

export default function UpdateTokens() {
  const { toast } = useLive();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api<{ tokens: Row[] }>("/api/update-tokens").then((r) => setRows(r.tokens ?? [])).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  const make = async () => {
    setBusy(true);
    try {
      const r = await api<{ name: string; token: string }>("/api/update-tokens", { name });
      setFresh({ name: r.name, token: r.token });
      setName("");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not make a token", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card px-5 py-2">
      <p className="py-3 text-[13px] text-[var(--ink-2)]">
        Lets another app — the tracking code, say — file updates straight into <b>Team updates</b>, where you approve them exactly as you do the ones written in the
        portal. Nothing reaches a client or a ClickUp task without your approval. The app says who wrote each update, and the name has to be someone on the team.
      </p>

      {fresh && (
        <div className="mb-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
          <p className="text-[13px] font-medium">{fresh.name} — copy this now</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">It is not shown again. Paste it into that app&apos;s configuration, never into its source code.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 text-[12.5px]">{fresh.token}</code>
            <button
              className="btn btn-sm shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(fresh.token).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
            </button>
            <button className="btn btn-ghost btn-sm shrink-0" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        {(rows ?? []).map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {t.name} <span className="text-[var(--muted)]">· …{t.tail}</span>
            </span>
            <span className="shrink-0 text-[12px] text-[var(--muted)]">{t.lastUsed ? `used ${ago(t.lastUsed)}` : "never used"}</span>
            <button
              className="btn btn-ghost btn-sm shrink-0 !px-2"
              title="Revoke"
              onClick={async () => {
                if (!confirm(`Revoke "${t.name}"? Any app using it stops being able to file updates.`)) return;
                await api("/api/update-tokens", { action: "revoke", id: t.id });
                load();
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {rows !== null && !rows.length && <p className="py-2.5 text-[13px] text-[var(--muted)]">No app can file updates yet.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] py-3">
        <input className="input !h-8 !w-[200px] !py-0 text-[13px]" placeholder="What is it for, e.g. Tracking app" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-dark btn-sm shrink-0" disabled={busy || !name.trim()} onClick={make}>
          <Plus size={13} /> Make a token
        </button>
      </div>
    </div>
  );
}
