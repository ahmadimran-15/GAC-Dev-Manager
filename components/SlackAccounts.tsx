"use client";
import { useEffect, useState } from "react";
import { Hash, Trash2 } from "lucide-react";
import { api, useLive } from "@/components/Live";

// Slack workspaces, connected with a user token so your own DMs come through. One row per workspace:
// two Slacks means two tokens, each from its own app.

interface Acc {
  id: string;
  label: string;
  address: string;
  enabled: boolean;
  status: { ok: boolean; at: number; error?: string } | null;
}

export default function SlackAccounts() {
  const { toast, refresh } = useLive();
  const [accounts, setAccounts] = useState<Acc[] | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api<{ accounts: Acc[] }>("/api/slack").then((r) => setAccounts(r.accounts ?? [])).catch(() => setAccounts([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    setBusy(true);
    try {
      const r = await api<{ team: string; user: string }>("/api/slack", { token });
      toast(`Connected ${r.team} as ${r.user}`);
      setToken("");
      await load();
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Slack rejected that token", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card px-5 py-2">
      <p className="py-3 text-[13px] text-[var(--ink-2)]">
        Your Slack DMs, read with a <b>User OAuth Token</b> (starts <code>xoxp-</code>). A bot token cannot see your own messages, so that is the one to use. One token per
        workspace. Nothing is posted anywhere until you reply from the inbox.
      </p>

      <div className="divide-y divide-[var(--line)]">
        {(accounts ?? []).map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Hash size={15} className="shrink-0 text-[#8a3ffc]" />
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {a.label} <span className="text-[var(--muted)]">· {a.address}</span>
            </span>
            <span className={`shrink-0 text-[12px] ${a.status?.ok === false ? "text-[var(--red)]" : "text-[var(--muted)]"}`}>
              {a.status?.ok === false ? (a.status.error ?? "not working").slice(0, 60) : a.status?.ok ? "reading DMs" : "not checked yet"}
            </span>
            <button
              className="btn btn-ghost btn-sm shrink-0 !px-2"
              title="Disconnect"
              onClick={async () => {
                if (!confirm(`Disconnect ${a.label}? The messages already in the inbox stay.`)) return;
                await api("/api/slack", { action: "remove", id: a.id });
                load();
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {accounts !== null && !accounts.length && <p className="py-2.5 text-[13px] text-[var(--muted)]">No Slack workspace connected yet.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] py-3">
        <input className="input !py-1.5 min-w-[260px] flex-1" type="password" autoComplete="off" placeholder="xoxp-…" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn btn-dark btn-sm shrink-0" disabled={busy || !token.trim()} onClick={add}>
          Connect workspace
        </button>
      </div>
    </div>
  );
}
