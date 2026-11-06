"use client";
import { useEffect, useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { api, useLive } from "@/components/Live";

// Messages that go into a group by themselves at a set time every day — the SOD and EOD nudges in the
// Ladeena group, for instance. "@Ali" in the text becomes a real WhatsApp mention when it goes out.

interface Row {
  id: string;
  enabled: boolean;
  label: string;
  chat: string;
  chatName?: string;
  found?: boolean;
  time: string;
  days: number[];
  text: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const blank = (): Row => ({ id: `s_${Math.random().toString(36).slice(2, 10)}`, enabled: true, label: "", chat: "", time: "11:00", days: [], text: "" });

export default function ScheduledMessages() {
  const { toast } = useLive();
  const [rows, setRows] = useState<Row[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = () =>
    api<{ schedules: Row[]; groups: { id: string; name: string }[] }>("/api/schedules").then((r) => {
      setRows(r.schedules ?? []);
      setGroups(r.groups ?? []);
      setDirty(false);
    });
  useEffect(() => {
    load();
  }, []);

  const edit = (id: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ schedules: Row[] }>("/api/schedules", { schedules: rows });
      setRows(r.schedules ?? []);
      setDirty(false);
      toast("Scheduled messages saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card px-5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 py-3">
        <p className="text-[13px] text-[var(--ink-2)]">
          Posted into the group on their own, every day at the time you set. Write <code>@Ali</code> in the text and it goes out as a real mention.
        </p>
        <div className="flex shrink-0 gap-2">
          <button className="btn btn-sm" onClick={() => (setRows((rs) => [...rs, blank()]), setDirty(true))}>
            <Plus size={13} /> Add
          </button>
          <button className="btn btn-dark btn-sm" disabled={busy || !dirty} onClick={save}>
            Save
          </button>
        </div>
      </div>

      {!rows.length && <p className="pb-3 text-[13px] text-[var(--muted)]">Nothing scheduled yet.</p>}

      <div className="divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <div key={r.id} className={`py-3 ${r.enabled ? "" : "opacity-55"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[var(--ink)]"
                checked={r.enabled}
                onChange={(e) => edit(r.id, { enabled: e.target.checked })}
                title={r.enabled ? "On" : "Off"}
              />
              <input className="input !h-8 !w-[150px] !py-0 text-[13px]" placeholder="Name, e.g. Ladeena SOD" value={r.label} onChange={(e) => edit(r.id, { label: e.target.value })} />
              <select className="input !h-8 !w-[220px] !py-0 text-[13px]" value={r.chat} onChange={(e) => edit(r.id, { chat: e.target.value })}>
                <option value="">Pick a group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                {r.chat && !groups.some((g) => g.id === r.chat) && <option value={r.chat}>{r.chatName ?? r.chat}</option>}
              </select>
              <input className="input !h-8 !w-[96px] !py-0 text-[13px]" type="time" value={r.time} onChange={(e) => edit(r.id, { time: e.target.value })} />
              <button
                className="btn btn-ghost btn-sm ml-auto !px-2"
                title="Remove"
                onClick={() => (setRows((rs) => rs.filter((x) => x.id !== r.id)), setDirty(true))}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[12px] text-[var(--muted)]">Days:</span>
              {DAYS.map((d, i) => {
                const on = !r.days.length || r.days.includes(i);
                return (
                  <button
                    key={d}
                    onClick={() => {
                      const now = r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6];
                      const next = now.includes(i) ? now.filter((x) => x !== i) : [...now, i].sort();
                      edit(r.id, { days: next.length === 7 ? [] : next });
                    }}
                    className={`rounded-md px-1.5 py-0.5 text-[11.5px] transition ${on ? "bg-[#171717] text-white" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}
                  >
                    {d}
                  </button>
                );
              })}
              {!r.days.length && <span className="ml-1 text-[11.5px] text-[var(--muted)]">every day</span>}
            </div>

            <textarea
              dir="auto"
              rows={2}
              className="input mt-2 min-h-[52px] resize-y text-[13.5px] leading-relaxed"
              placeholder="@Ali Please send the SOD report and the timer screenshot."
              value={r.text}
              onChange={(e) => edit(r.id, { text: e.target.value })}
            />
            {r.found === false && r.chat && <p className="mt-1 text-[12px] text-[var(--amber)]">That group isn&apos;t in the inbox yet, so nothing will be sent.</p>}
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="flex items-center gap-2 border-t border-[var(--line)] py-3 text-[12.5px] text-[var(--muted)]">
          <Send size={13} />
          Each one goes once a day. Changing the time to one already past today will send it within the minute.
        </div>
      )}
    </div>
  );
}
