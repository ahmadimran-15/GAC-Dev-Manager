"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock, Search, Send, Users } from "lucide-react";
import Guard from "@/components/Guard";
import MessageText from "@/components/MessageText";
import { Avatar, Ticks, Waiting, ago } from "@/components/ui";

interface Chat {
  id: string;
  label: string;
  group: boolean;
  project: string | null;
  waiting: boolean;
  waitingSince: number | null;
  last: { text: string; direction: string; at: number } | null;
}
interface Thread {
  now: number;
  chat: { id: string; label: string; group: boolean; project: string | null; days: number };
  messages: { id: string; direction: string; at: number; text: string; by: string | null; ours: boolean; status?: string | null }[];
  mine: { id: string; text: string; created_at: number; status: string }[];
}

const time = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
// 401 means signed out, 403 means the owner has just taken this half away — either way the page
// should not sit there showing what it loaded a minute ago.
const get = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (r.status === 401) return ((location.href = "/login"), null);
    if (r.status === 403) return ((location.href = "/form"), null);
    return r.json();
  });

// Team portal → WhatsApp: the client chats without any numbers, and replies that go to the manager for approval.
export default function TeamInbox() {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const loadList = useCallback(() => get("/api/portal/inbox").then((d) => d && (setChats(d.chats), setNow(d.now))), []);
  const loadThread = useCallback((id: string) => get(`/api/portal/inbox?c=${id}`).then((d) => d && !d.error && setThread(d)), []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 20_000);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    setThread(null);
    setNote(null);
    if (!open) return;
    loadThread(open);
    const t = setInterval(() => loadThread(open), 15_000);
    return () => clearInterval(t);
  }, [open, loadThread]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [thread?.messages.length, thread?.mine.length]);

  async function send() {
    if (!open || !text.trim()) return;
    setBusy(true);
    setNote(null);
    const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conv_id: open, text }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      setText("");
      setNote({ ok: true, text: "Sent to your manager for approval. It goes to the client once approved." });
      loadThread(open);
    } else setNote({ ok: false, text: d.error ?? "Failed" });
  }

  const shown = (chats ?? []).filter((c) => !q || `${c.label} ${c.project ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="card grid h-[calc(100dvh/var(--ui-zoom)-170px)] min-h-[480px] grid-cols-1 overflow-hidden md:grid-cols-[300px_minmax(0,1fr)]">
      {/* Chats */}
      <div className={`min-h-0 flex-col border-r border-[var(--line)] ${open ? "hidden md:flex" : "flex"}`}>
        <div className="p-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input !py-2 !pl-9 text-[13.5px]" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="scroll min-h-0 flex-1 px-2 pb-2">
          {shown.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpen(c.id)}
              className={`flex w-full gap-3 rounded-xl px-3 py-2.5 text-left ${open === c.id ? "bg-white shadow-[0_0_0_1px_var(--line-2)]" : "hover:bg-[var(--bg)]"}`}
            >
              {c.group ? <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[var(--bg)] text-[var(--ink-2)]"><Users size={15} /></span> : <Avatar name={c.label} size={34} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-[13.5px] ${c.waiting ? "font-semibold" : ""}`}>{c.label}</span>
                  {c.waiting && c.waitingSince ? <Waiting since={c.waitingSince} now={now} /> : <span className="shrink-0 text-[11px] text-[var(--muted)]">{c.last ? ago(c.last.at, now) : ""}</span>}
                </div>
                <div className="truncate text-[12.5px] text-[var(--muted)]">{c.last?.text ?? ""}</div>
              </div>
            </button>
          ))}
          {chats && !shown.length && <p className="p-6 text-center text-[13px] text-[var(--muted)]">No chats</p>}
          {!chats && <p className="p-6 text-center text-[13px] text-[var(--muted)]">Loading…</p>}
        </div>
      </div>

      {/* Thread */}
      <div className={`min-h-0 flex-col ${open ? "flex" : "hidden md:flex"}`}>
        {!open && <div className="grid flex-1 place-items-center text-[13.5px] text-[var(--muted)]">Pick a chat</div>}
        {open && (
          <Guard what="this chat" key={open}>
            <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
              <button className="btn btn-ghost !h-8 !w-8 !p-0 md:hidden" onClick={() => setOpen(null)} title="All chats">
                <ArrowLeft size={17} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{thread?.chat.label ?? "…"}</div>
                <div className="text-[12px] text-[var(--muted)]">
                  {thread?.chat.group ? "WhatsApp group" : "WhatsApp"}
                  {thread?.chat.project ? ` · ${thread.chat.project}` : ""}
                  {thread ? ` · last ${thread.chat.days} days` : ""}
                </div>
              </div>
            </div>
            <div className="scroll min-h-0 flex-1 space-y-2 px-4 py-4">
              {thread?.messages.map((m) => (
                <div key={m.id} className={`flex ${m.ours ? "justify-end" : ""}`}>
                  <div className={`max-w-[85%] md:max-w-[70%] ${m.ours ? "text-right" : ""}`}>
                    <div className={`inline-block rounded-2xl px-3.5 py-2 text-left text-[13.5px] leading-relaxed ${m.ours ? "rounded-br-md bg-[#171717] text-white" : m.direction === "out" ? "rounded-bl-md bg-[#eaf2fb]" : "rounded-bl-md bg-[var(--bg)]"}`}>
                      {m.direction === "out" && !m.ours && m.by && <div className="mb-0.5 text-[12px] font-semibold text-[var(--blue)]">{m.by} · team</div>}
                      <MessageText text={m.text} dark={m.ours} />
                    </div>
                    <div className="mt-0.5 px-1 text-[11px] text-[var(--muted)]">
                      {m.ours && m.by ? `${m.by} · ` : ""}
                      {time(m.at)}
                      {m.direction === "out" && <Ticks status={m.status ?? null} />}
                    </div>
                  </div>
                </div>
              ))}
              {thread?.mine
                .filter((d) => d.status !== "approved")
                .map((d) => (
                  <div key={d.id} className="flex justify-end">
                    <div className="max-w-[85%] text-right md:max-w-[70%]">
                      <div className="inline-block rounded-2xl rounded-br-md border border-dashed border-[var(--line-2)] bg-white px-3.5 py-2 text-left text-[13.5px] leading-relaxed text-[var(--ink-2)]">
                        <MessageText text={d.text} />
                      </div>
                      <div className="mt-0.5 inline-flex items-center gap-1 px-1 text-[11px] text-[var(--muted)]">
                        <Clock size={11} /> {d.status === "discarded" ? "Not sent by your manager" : "Waiting for approval"} · {time(d.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              {thread && !thread.messages.length && <p className="py-8 text-center text-[13px] text-[var(--muted)]">No messages in the last {thread.chat.days} days.</p>}
              {!thread && <p className="py-8 text-center text-[13px] text-[var(--muted)]">Loading…</p>}
              <div ref={end} />
            </div>
            <div className="border-t border-[var(--line)] p-3">
              {note && <p className={`mb-2 text-[12.5px] ${note.ok ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{note.text}</p>}
              <div className="flex items-end gap-2">
                <textarea
                  dir="auto"
                  rows={2}
                  className="input min-h-[44px] flex-1 resize-none text-[14px] leading-relaxed"
                  placeholder="Write a reply. Your manager approves it before the client sees it."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && send()}
                />
                <button className="btn btn-dark !h-[44px]" disabled={busy || !text.trim()} onClick={send} title="Send for approval">
                  <Send size={14} /> <span className="hidden sm:inline">For approval</span>
                </button>
              </div>
            </div>
          </Guard>
        )}
      </div>
    </div>
  );
}
