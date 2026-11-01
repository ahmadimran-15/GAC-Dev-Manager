"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, ListPlus, Mic, RotateCw, Search, Send, Sparkles, X } from "lucide-react";
import type { ConvSummary, Message } from "@/lib/store";
import { api, useLive, type DraftRow } from "@/components/Live";
import { Avatar, CHANNELS, Channel, Pill, Waiting, ago } from "@/components/ui";
import DraftCard from "@/components/DraftCard";
import TaskDrawer, { type BoardLite } from "@/components/TaskDrawer";
import { ackText } from "@/components/WaitingCard";
import { ListSkeleton, ThreadSkeleton } from "@/components/Skeleton";
import FromPicker from "@/components/FromPicker";
import { accountOf } from "@/components/Live";

interface Detail {
  conversation: ConvSummary & { subject: string | null };
  messages: Message[];
  drafts: DraftRow[];
}

const dayLabel = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};
const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const { state, refresh, send, toast } = useLive();
  const [filter, setFilter] = useState<"all" | "waiting">("all");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState(false);
  const [board, setBoard] = useState<BoardLite | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const convs = (state?.conversations ?? []).filter(
    (c) => (filter === "all" || c.waiting) && (!q || `${c.name} ${c.company ?? ""} ${c.project ?? ""}`.toLowerCase().includes(q.toLowerCase())),
  );
  const id = params.get("c") ?? state?.conversations[0]?.id ?? null;
  const now = state?.now ?? Date.now();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setDetail(await api<Detail>(`/api/conversations/${id}`));
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    api<BoardLite>("/api/team").then(setBoard).catch(() => {});
  }, []);

  useEffect(() => {
    setDetail(null);
    setReply("");
    setSelecting(false);
    setSel(new Set());
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [state?.now]); // eslint-disable-line react-hooks/exhaustive-deps

  const msgCount = detail?.messages.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgCount, id]);

  const c = detail?.conversation;

  async function doSend(text: string, ack = false) {
    if (!c || !text.trim()) return;
    setBusy(true);
    if (await send(c.id, text.trim(), ack, from || null)) {
      if (!ack) setReply("");
      await load();
    }
    setBusy(false);
  }

  async function action(body: Record<string, unknown>, msg?: string) {
    if (!c) return;
    try {
      const r = await api<{ suggestion?: string }>(`/api/conversations/${c.id}`, body);
      if (msg) toast(msg);
      await Promise.all([load(), refresh()]);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function polish() {
    setBusy(true);
    try {
      setReply((await api<{ text: string }>("/api/ai", { mode: "polish", text: reply })).text);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function toggle(mid: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(mid)) n.delete(mid);
      else n.add(mid);
      return n;
    });
  }

  function startTask() {
    if (!detail) return;
    if (!selecting) {
      const lastOut = [...detail.messages].reverse().find((m) => m.direction === "out")?.created_at ?? 0;
      setSel(new Set(detail.messages.filter((m) => m.direction === "in" && m.created_at > lastOut).map((m) => m.id)));
      setSelecting(true);
    } else if (sel.size) setDrawer(true);
  }

  const text = (m: Message) => m.text || m.transcript || "";

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <div className="card grid h-[calc(100vh-104px)] min-h-[560px] grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        {/* List */}
        <div className="flex min-h-0 flex-col border-r border-[var(--line)]">
          <div className="space-y-2.5 p-4">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input className="input !py-2 pl-9 text-[13.5px]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {(["all", "waiting"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-[12.5px] ${filter === f ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
                  {f === "all" ? "All" : `Waiting · ${state?.stats.waiting ?? 0}`}
                </button>
              ))}
            </div>
          </div>
          <div className="scroll min-h-0 flex-1 px-2 pb-2">
            {convs.map((x) => (
              <button
                key={x.id}
                onClick={() => router.replace(`/inbox?c=${x.id}`)}
                className={`flex w-full gap-3 rounded-xl px-3 py-3 text-left transition ${x.id === id ? "bg-[var(--bg)]" : "hover:bg-[var(--bg)]/60"}`}
              >
                <Avatar name={x.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-[14px] ${x.waiting ? "font-semibold" : ""}`}>{x.name}</span>
                    {x.waiting && x.waitingSince ? <Waiting since={x.waitingSince} now={now} /> : <span className="text-[11.5px] text-[var(--muted)]">{x.last ? ago(x.last.at, now) : ""}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Channel c={x.channel} withLabel={false} />
                    <span className={`truncate text-[13px] ${x.waiting ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                      {x.last?.direction === "out" ? "You: " : ""}
                      {x.last?.text}
                    </span>
                  </div>
                </div>
              </button>
            ))}
            {!state && <ListSkeleton />}
            {state && !convs.length && <div className="p-8 text-center text-[13px] text-[var(--muted)]">No conversations</div>}
          </div>
        </div>

        {/* Thread */}
        {c ? (
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-[var(--line)] px-6 py-3.5">
              <Avatar name={c.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {c.name}
                  {c.company && <span className="font-normal text-[var(--muted)]"> · {c.company}</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-3">
                  <Channel c={c.channel} account={accountOf(state?.accounts, c.account)?.label ?? (c.account || null)} />
                  <select
                    className="rounded-md bg-transparent text-[12.5px] text-[var(--ink-2)] outline-none hover:bg-[var(--hover)]"
                    value={c.project ?? ""}
                    onChange={(e) => action({ action: "project", project: e.target.value }, "Project saved")}
                  >
                    <option value="">No project</option>
                    {[...new Set([...(board?.projects ?? []), c.project ?? ""])].filter(Boolean).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  {c.demo && <Pill>Test data</Pill>}
                </div>
              </div>
              <button className={`btn btn-sm ${selecting ? "btn-dark" : ""}`} onClick={startTask}>
                <ListPlus size={14} /> {selecting ? `Create task from ${sel.size}` : "Create task"}
              </button>
              {c.status === "handled" ? (
                <button className="btn btn-sm btn-ghost" onClick={() => action({ action: "reopen" })}>
                  Reopen
                </button>
              ) : (
                <button className="btn btn-sm btn-ghost" onClick={() => action({ action: "handled" }, "Marked as handled")}>
                  <CheckCheck size={14} /> Handled
                </button>
              )}
            </div>

            {selecting && (
              <div className="flex items-center justify-between bg-[var(--bg)] px-6 py-2 text-[13px] text-[var(--ink-2)]">
                Tick the messages that belong in this task.
                <button className="btn btn-ghost btn-sm" onClick={() => (setSelecting(false), setSel(new Set()))}>
                  <X size={13} /> Cancel
                </button>
              </div>
            )}

            <div className="scroll min-h-0 flex-1 px-6 py-5">
              {detail.messages.map((m, i) => {
                const mine = m.direction === "out";
                const newDay = i === 0 || dayLabel(detail.messages[i - 1].created_at) !== dayLabel(m.created_at);
                const picked = sel.has(m.id);
                return (
                  <div key={m.id}>
                    {newDay && <div className="my-4 text-center text-[11.5px] font-medium text-[var(--muted)]">{dayLabel(m.created_at)}</div>}
                    <div className={`mb-2 flex items-end gap-2 ${mine ? "justify-end" : ""}`}>
                      {!mine && selecting && (
                        <button onClick={() => toggle(m.id)} className={`mb-6 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${picked ? "border-[#171717] bg-[#171717] text-white" : "border-[var(--line-2)] bg-white"}`}>
                          {picked && <CheckCheck size={11} />}
                        </button>
                      )}
                      <div className={`max-w-[70%] ${mine ? "items-end text-right" : ""} flex flex-col`}>
                        <div
                          dir="auto"
                          onClick={() => !mine && selecting && toggle(m.id)}
                          className={`inline-block whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-left text-[14px] leading-relaxed ${
                            mine
                              ? m.ack
                                ? "rounded-br-md border border-[var(--line-2)] bg-white text-[var(--ink-2)]"
                                : "rounded-br-md bg-[#171717] text-white"
                              : `rounded-bl-md bg-[var(--bg)] text-[var(--ink)] ${picked ? "ring-2 ring-[#171717]" : ""} ${selecting ? "cursor-pointer" : ""}`
                          }`}
                        >
                          {m.kind === "voice" && (
                            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]">
                              <Mic size={13} /> Voice note
                            </div>
                          )}
                          {m.kind === "voice" && m.media_path && <audio controls src={`/api/media/${m.media_path}`} className="mb-2 h-9 w-64 max-w-full" />}
                          {text(m) || (m.kind === "voice" ? <span className="italic text-[var(--muted)]">{state?.connections.transcription ? "Transcribing…" : "Add GOOGLE_AI_API_KEY to transcribe voice notes"}</span> : null)}
                        </div>
                        <div className="mt-1 px-1 text-[11px] text-[var(--muted)]">
                          {mine && m.ack ? "Acknowledged · " : ""}
                          {mine && m.sent_by && m.sent_by !== "me" ? `${m.sent_by === "phone" ? "From your phone" : `Written by ${m.sent_by}`} · ` : ""}
                          {m.via ? `${mine ? "from" : "to"} ${m.via} · ` : ""}
                          {time(m.created_at)}
                          {m.status === "simulated" ? " · test mode" : ""}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {detail.drafts.map((d) => (
                <div key={d.id} className="mt-4">
                  <DraftCard d={{ ...d, conv_name: c.name, channel: c.channel }} now={now} inThread />
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <div className="border-t border-[var(--line)] px-6 py-4">
              {c.waiting && c.suggestion && !reply && (
                <div className="mb-3 flex items-start gap-3 rounded-xl bg-[var(--bg)] px-4 py-3">
                  <Sparkles size={14} className="mt-1 shrink-0 text-[var(--muted)]" />
                  <p className="flex-1 text-[13.5px] leading-relaxed text-[var(--ink-2)]">{c.suggestion}</p>
                  <div className="flex shrink-0 gap-1">
                    <button className="btn btn-ghost btn-sm !px-2" title="Write another" onClick={() => action({ action: "suggest" })}>
                      <RotateCw size={13} />
                    </button>
                    <button className="btn btn-sm" onClick={() => setReply(c.suggestion ?? "")}>
                      Use
                    </button>
                  </div>
                </div>
              )}
              <div className="mb-2 flex items-center justify-between">
                <FromPicker channel={c.channel} account={c.account} value={from} onChange={setFrom} />
              </div>
              <div className="rounded-2xl border border-[var(--line-2)] bg-white focus-within:border-[#a8a8a2]">
                <textarea
                  dir="auto"
                  rows={2}
                  className="w-full resize-none rounded-2xl bg-transparent px-4 pt-3 text-[14px] leading-relaxed outline-none placeholder:text-[var(--muted)]"
                  placeholder={`Reply on ${CHANNELS[c.channel]?.label ?? c.channel}…`}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && doSend(reply)}
                />
                <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => doSend(ackText(c.name), true)} title={ackText(c.name)}>
                    Acknowledge
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busy || !reply.trim()} onClick={polish}>
                    <Sparkles size={13} /> Polish
                  </button>
                  <button className="btn btn-dark btn-sm ml-auto" disabled={busy || !reply.trim()} onClick={() => doSend(reply)}>
                    <Send size={13} /> Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          state?.conversations.length === 0 ? <div className="grid place-items-center text-[var(--muted)]">No conversations yet</div> : <ThreadSkeleton />
        )}
      </div>

      {drawer && detail && (
        <TaskDrawer
          messages={detail.messages.filter((m) => sel.has(m.id)).map(text)}
          project={c?.project ?? null}
          board={board}
          onClose={() => {
            setDrawer(false);
            setSelecting(false);
            setSel(new Set());
          }}
        />
      )}
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}
