"use client";
import { useEffect, useState } from "react";
import { AtSign, Loader2, MessageCircle, RotateCw, Search, Users, User, X } from "lucide-react";
import { useLive } from "@/components/Live";

export interface RecipientTarget {
  channel: "whatsapp" | "email";
  from: string; // account id
  to: string; // chat id (…@c.us / …@g.us) or email address
  toName: string;
  subject?: string;
}

interface Hit {
  id: string;
  name: string;
  number?: string;
}

// Pick who a message goes to: a WhatsApp group or contact from your phone (searchable), or an email
// address, plus which of your accounts it's sent from.
export default function RecipientPicker({ value, onChange }: { value: RecipientTarget | null; onChange: (t: RecipientTarget | null) => void }) {
  const { state } = useLive();
  const was = (state?.accounts ?? []).filter((a) => a.kind === "whatsapp" && a.enabled && a.canSend);
  const mails = (state?.accounts ?? []).filter((a) => a.kind === "email" && a.enabled && a.canSend);
  const [channel, setChannel] = useState<"whatsapp" | "email">(value?.channel ?? (was.length ? "whatsapp" : "email"));
  const [from, setFrom] = useState(value?.from ?? "");
  const [mode, setMode] = useState<"groups" | "contacts">("groups");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [to, setTo] = useState(value?.channel === "email" ? value.to : "");
  const [subject, setSubject] = useState(value?.subject ?? "");
  const [refresh, setRefresh] = useState(0);

  const options = channel === "whatsapp" ? was : mails;
  useEffect(() => {
    if (!options.some((o) => o.id === from)) setFrom(options[0]?.id ?? "");
  }, [channel, options.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search groups / contacts as you type
  useEffect(() => {
    if (channel !== "whatsapp" || !from) return;
    setLoading(true);
    setErr("");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/whatsapp/targets?account=${from}&type=${mode}&q=${encodeURIComponent(q)}${refresh ? "&refresh=1" : ""}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed");
        setHits(d.results);
        setTotal(d.total);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [channel, from, mode, q, refresh]);

  // Email: report the target as soon as the address looks valid
  useEffect(() => {
    if (channel !== "email") return;
    if (from && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) onChange({ channel: "email", from, to: to.trim(), toName: to.trim(), subject: subject || undefined });
    else if (value?.channel === "email") onChange(null);
  }, [channel, from, to, subject]); // eslint-disable-line react-hooks/exhaustive-deps

  const knownEmails = [...new Set((state?.conversations ?? []).filter((c) => c.channel === "email").map((c) => c.externalId))];
  const pickedWa = value?.channel === "whatsapp" ? value : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-[var(--bg)] p-0.5">
          {(["whatsapp", "email"] as const).map((c) => (
            <button
              key={c}
              onClick={() => {
                setChannel(c);
                onChange(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] ${channel === c ? "bg-white font-medium shadow-sm" : "text-[var(--ink-2)]"}`}
            >
              {c === "whatsapp" ? <MessageCircle size={13} className="text-[#1fa855]" /> : <AtSign size={13} className="text-[#d0590f]" />}
              {c === "whatsapp" ? "WhatsApp" : "Email"}
            </button>
          ))}
        </div>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
          From
          <select
            className="rounded-md bg-transparent px-1 py-0.5 font-medium text-[var(--ink)] outline-none hover:bg-[var(--hover)]"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (channel === "whatsapp") onChange(null);
            }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.kind === "email" ? o.address : `${o.label}${/^\d+$/.test(o.address) ? ` · +${o.address}` : ""}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!options.length && <p className="text-[13px] text-[var(--amber)]">No {channel === "email" ? "mailbox" : "WhatsApp number"} is set up for sending. Add one in Settings.</p>}

      {channel === "whatsapp" && from && (
        <>
          {pickedWa ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--line-2)] bg-white px-3 py-2">
              {pickedWa.to.endsWith("@g.us") ? <Users size={15} className="text-[var(--muted)]" /> : <User size={15} className="text-[var(--muted)]" />}
              <span className="min-w-0 flex-1 truncate text-[14px]">
                <span className="text-[var(--muted)]">To </span>
                <b className="font-medium">{pickedWa.toName}</b>
              </span>
              <button className="btn btn-ghost btn-sm !h-6 !px-1.5" onClick={() => onChange(null)} title="Change">
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--line-2)] bg-white">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
                <div className="inline-flex rounded-md bg-[var(--bg)] p-0.5">
                  {(["groups", "contacts"] as const).map((m) => (
                    <button key={m} onClick={() => setMode(m)} className={`rounded px-2.5 py-0.5 text-[12.5px] ${mode === m ? "bg-white font-medium shadow-sm" : "text-[var(--ink-2)]"}`}>
                      {m === "groups" ? "Groups" : "Contacts"}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input autoFocus className="w-full bg-transparent py-1 pl-7 text-[13.5px] outline-none placeholder:text-[var(--muted)]" placeholder={mode === "groups" ? "Search your groups" : "Search contacts by name or number"} value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <button className="btn btn-ghost btn-sm !h-6 !px-1.5" title="Reload from WhatsApp" onClick={() => setRefresh((x) => x + 1)}>
                  <RotateCw size={12} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
              <div className="scroll max-h-56">
                {loading && !hits.length && (
                  <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-[var(--muted)]">
                    <Loader2 size={14} className="animate-spin" /> Loading {mode} from WhatsApp…
                  </div>
                )}
                {err && <div className="px-3 py-3 text-[13px] text-[var(--red)]">{err}</div>}
                {hits.map((h) => (
                  <button key={h.id} onClick={() => onChange({ channel: "whatsapp", from, to: h.id, toName: h.name })} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg)]">
                    {mode === "groups" ? <Users size={14} className="shrink-0 text-[var(--muted)]" /> : <User size={14} className="shrink-0 text-[var(--muted)]" />}
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{h.name}</span>
                    {h.number && <span className="tnum shrink-0 text-[12px] text-[var(--muted)]">+{h.number}</span>}
                  </button>
                ))}
                {!loading && !err && !hits.length && <div className="px-3 py-3 text-[13px] text-[var(--muted)]">No {mode} match “{q}”.</div>}
              </div>
              {total > 0 && <div className="border-t border-[var(--line)] px-3 py-1.5 text-[11.5px] text-[var(--muted)]">{total} {mode} · showing {hits.length}</div>}
            </div>
          )}
        </>
      )}

      {channel === "email" && from && (
        <div className="space-y-2">
          <input className="input" type="email" list="known-emails" placeholder="To: client@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
          <datalist id="known-emails">{knownEmails.map((e) => <option key={e} value={e} />)}</datalist>
          <input className="input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
    </div>
  );
}
