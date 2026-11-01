"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { Avatar, ago } from "@/components/ui";

interface TeamNumber {
  name: string;
  number: string;
}

interface Backfill {
  at: number;
  tookMs: number;
  newConversations: number;
  markedHandled: number;
  accounts: { account: string; scanned: number; chats: number; groups: number; stored: number; skipped?: string }[];
}

type Status = { last: Backfill | null; running: { phase: string; scanned: number } | null };

// Numbers on our side (boss, partner, company number) and the WhatsApp history import.
export default function TeamNumbersManager() {
  const { toast, refresh } = useLive();
  const [list, setList] = useState<TeamNumber[]>([]);
  const [f, setF] = useState({ name: "", number: "" });
  const [st, setSt] = useState<Status>({ last: null, running: null });

  const loadStatus = () => api<Status>("/api/whatsapp/backfill").then(setSt).catch(() => {});
  useEffect(() => {
    api<{ numbers: TeamNumber[] }>("/api/team-numbers").then((r) => setList(r.numbers));
    loadStatus();
  }, []);
  // Follow a running import
  useEffect(() => {
    if (!st.running) return;
    const id = setInterval(async () => {
      const s = await api<Status>("/api/whatsapp/backfill").catch(() => null);
      if (!s) return;
      setSt(s);
      if (!s.running && s.last) {
        toast(`Imported ${s.last.accounts.reduce((n, a) => n + a.stored, 0)} messages from ${s.last.accounts.reduce((n, a) => n + a.chats, 0)} chats`);
        refresh();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [!!st.running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: TeamNumber[], msg: string) {
    try {
      setList((await api<{ numbers: TeamNumber[] }>("/api/team-numbers", { numbers: next })).numbers);
      toast(msg);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
      return false;
    }
  }

  const last = st.last;
  return (
    <div className="card px-5 py-2">
      <p className="py-3 text-[13px] text-[var(--ink-2)]">
        When one of these numbers (or you) writes in a client group, the client counts as answered and you see who replied. Direct chats with them are internal and never trigger reminders.
      </p>
      <div className="divide-y divide-[var(--line)]">
        {list.map((t, i) => (
          <div key={t.number} className="flex items-center gap-3 py-2.5">
            <Avatar name={t.name} size={26} />
            <span className="flex-1 text-[13.5px]">
              <b className="font-medium">{t.name}</b> <span className="tnum text-[var(--muted)]">+{t.number}</span>
            </span>
            <button className="btn btn-ghost btn-sm !px-2" onClick={() => save(list.filter((_, j) => j !== i), `${t.name} removed`)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-[var(--line)] py-3">
        <input className="input !py-1.5" placeholder="Name (e.g. Yusuf)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input !py-1.5" placeholder="WhatsApp number with country code" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
        <button
          className="btn btn-sm shrink-0"
          disabled={!f.name.trim() || f.number.replace(/[^\d]/g, "").length < 8}
          onClick={async () => (await save([...list, f], `${f.name} added`)) && setF({ name: "", number: "" })}
        >
          <Plus size={13} /> Add
        </button>
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--line)] py-3">
        <p className="flex-1 text-[12.5px] text-[var(--muted)]">
          {st.running
            ? `${st.running.phase}… ${st.running.scanned} messages read`
            : "Earlier messages are imported automatically when WhatsApp connects (last 7 days: direct chats, and groups where you or a team number wrote)."}
          {!st.running &&
            last &&
            ` Last import ${ago(last.at)}: ${last.accounts.map((a) => (a.skipped ? `${a.account} skipped (${a.skipped})` : `${a.stored} new messages in ${a.chats} chats`)).join(", ")}.`}
        </p>
        <button
          className="btn btn-sm shrink-0"
          disabled={!!st.running}
          onClick={async () => {
            try {
              const r = await api<{ running: Status["running"] }>("/api/whatsapp/backfill", { full: true });
              setSt((s) => ({ ...s, running: r.running ?? { phase: "Starting", scanned: 0 } }));
            } catch (e) {
              toast(e instanceof Error ? e.message : "Import failed", "error");
            }
          }}
        >
          {st.running ? "Importing…" : "Import recent chats"}
        </button>
      </div>
    </div>
  );
}
