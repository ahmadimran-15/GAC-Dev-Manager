"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { api, useLive } from "@/components/Live";

// The Discord bot. One token; the servers listed are the ones it has actually been invited to, read
// from the live connection rather than from anything typed here.

interface Acc {
  id: string;
  label: string;
  status: { ok: boolean; at: number; error?: string } | null;
  servers: { server: string; channels: string[] }[];
}

export default function DiscordBot() {
  const { toast, refresh } = useLive();
  const [accounts, setAccounts] = useState<Acc[] | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api<{ accounts: Acc[] }>("/api/discord").then((r) => setAccounts(r.accounts ?? [])).catch(() => setAccounts([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    setBusy(true);
    try {
      await api("/api/discord", { token, label: "Discord" });
      toast("Discord bot connected");
      setToken("");
      setTimeout(load, 2500); // the servers appear once the connection is up
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Discord rejected that token", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card px-5 py-2">
      <p className="py-3 text-[13px] text-[var(--ink-2)]">
        Server channels the bot has been invited to arrive in the inbox, and a reply goes back as the bot. Discord has no way for an app to post as you, and no way for
        it to read anyone&apos;s private DMs.
      </p>

      <div className="divide-y divide-[var(--line)]">
        {(accounts ?? []).map((a) => (
          <div key={a.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{a.label}</span>
              <span className={`shrink-0 text-[12px] ${a.status?.ok === false ? "text-[var(--red)]" : a.status?.ok ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
                {a.status?.ok === false ? (a.status.error ?? "not connected").slice(0, 60) : a.status?.ok ? "connected" : "connecting…"}
              </span>
              <button className="btn btn-ghost btn-sm shrink-0 !px-2" title="Reconnect" onClick={async () => (await api("/api/discord", { action: "reconnect" }), setTimeout(load, 2000))}>
                <RefreshCw size={13} />
              </button>
              <button
                className="btn btn-ghost btn-sm shrink-0 !px-2"
                title="Disconnect"
                onClick={async () => {
                  if (!confirm("Disconnect the Discord bot? Messages already in the inbox stay.")) return;
                  await api("/api/discord", { action: "remove", id: a.id });
                  load();
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {a.servers.length > 0 ? (
              <div className="mt-1 text-[12.5px] text-[var(--muted)]">
                {a.servers.map((s) => (
                  <div key={s.server} className="truncate">
                    {s.server}: {s.channels.slice(0, 8).join(", ")}
                    {s.channels.length > 8 ? ` +${s.channels.length - 8} more` : ""}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[12.5px] text-[var(--amber)]">Not in any server yet — open the invite link and authorise it.</p>
            )}
          </div>
        ))}
        {accounts !== null && !accounts.length && <p className="py-2.5 text-[13px] text-[var(--muted)]">No Discord bot connected yet.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] py-3">
        <input className="input !py-1.5 min-w-[260px] flex-1" type="password" autoComplete="off" placeholder="Bot token from the Discord developer portal" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn btn-dark btn-sm shrink-0" disabled={busy || !token.trim()} onClick={add}>
          Connect bot
        </button>
      </div>
    </div>
  );
}
