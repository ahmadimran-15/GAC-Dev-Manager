"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, CheckCheck, ChevronDown, ChevronUp, ListPlus, Mic, PenSquare, RotateCw, Search, Send, Sparkles, X } from "lucide-react";
import Composer from "@/components/Composer";
import type { ConvSummary, Message } from "@/lib/store";
import { api, useLive, type DraftRow } from "@/components/Live";
import { Avatar, CHANNELS, Channel, Pill, STATUS_TONE, Waiting, ago } from "@/components/ui";
import DraftCard from "@/components/DraftCard";
import TaskDrawer, { type BoardLite } from "@/components/TaskDrawer";
import { ReplyBox, ackText } from "@/components/WaitingCard";
import { ListSkeleton, ThreadSkeleton } from "@/components/Skeleton";
import FromPicker from "@/components/FromPicker";
import { accountOf } from "@/components/Live";

interface Detail {
  conversation: ConvSummary & { subject: string | null };
  messages: Message[];
  drafts: DraftRow[];
  links: { task_id: string; title: string; url: string | null; project: string | null; message_ids: string[]; created_at: number }[];
}

const REMIND = [null, 5, 15, 30, 60] as const;

// A labelled dropdown that looks clickable: "Project: Ladeena ▾"
function ChipSelect({ label, value, onChange, title, children }: { label: string; value: string; onChange: (v: string) => void; title?: string; children: React.ReactNode }) {
  return (
    <label title={title} className="relative inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--line-2)] bg-white pl-2.5 pr-7 text-[12.5px] hover:border-[#a8a8a2]">
      <span className="mr-1.5 text-[var(--muted)]">{label}</span>
      <select className="max-w-[200px] cursor-pointer appearance-none truncate bg-transparent font-medium text-[var(--ink)] outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-[var(--ink-2)]" />
    </label>
  );
}

// WhatsApp ticks for our messages: ✓ sent, ✓✓ delivered, blue ✓✓ read, red ! failed
function Ticks({ status }: { status: string | null }) {
  if (status === "failed") return <span className="ml-1 font-semibold text-[var(--red)]" title="Not delivered">!</span>;
  if (!status || !["sent", "delivered", "read"].includes(status)) return null;
  const Icon = status === "sent" ? Check : CheckCheck;
  return (
    <span className="ml-1 inline-flex translate-y-[2px]" title={status === "read" ? "Read" : status === "delivered" ? "Delivered" : "Sent"}>
      <Icon size={13} strokeWidth={2.4} style={{ color: status === "read" ? "#34b7f1" : "var(--muted)" }} />
    </span>
  );
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
  const [channel, setChannel] = useState("all");
  const [contextBusy, setContextBusy] = useState(false);
  const contextAsked = useRef<Set<string>>(new Set());
  // Context box shown or hidden, remembered in this browser
  const [showContext, setShowContext] = useState(true);
  useEffect(() => {
    try {
      setShowContext(localStorage.getItem("gac_show_context") !== "0");
    } catch {}
  }, []);
  const toggleContext = (v: boolean) => {
    setShowContext(v);
    try {
      localStorage.setItem("gac_show_context", v ? "1" : "0");
    } catch {}
  };

  // "WhatsApp · +92300…", "WhatsApp group", "Email · client@x.com → your mailbox" (the account only when you have several)
  const channelLine = (x: ConvSummary) => {
    const label = CHANNELS[x.channel]?.label ?? x.channel;
    const mine = (state?.accounts ?? []).filter((a) => a.kind === x.channel);
    const acc = accountOf(state?.accounts, x.account);
    const via = mine.length > 1 && acc ? ` → ${x.channel === "email" ? acc.address : acc.label}` : "";
    if (x.channel === "whatsapp") return x.externalId.endsWith("@g.us") ? `WhatsApp group${via}` : `${label}${/^\d+$/.test(x.externalId) ? ` · +${x.externalId}` : ""}${via}`;
    return `${label}${x.externalId ? ` · ${x.externalId}` : ""}${via}`;
  };
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [composing, setComposing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState(false);
  const [board, setBoard] = useState<BoardLite | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const isGroup = (c: ConvSummary) => c.channel === "whatsapp" && c.externalId.endsWith("@g.us");
  // "whatsapp", "groups", "email", "team", or one mailbox / number (an account key)
  const inChannel = (c: ConvSummary) =>
    channel === "all" ||
    (channel === "groups" ? isGroup(c) : channel === "team" ? c.internal : channel === "whatsapp" || channel === "email" ? c.channel === channel : c.account.toLowerCase() === channel.toLowerCase());
  const convs = (state?.conversations ?? []).filter(
    (c) => (filter === "all" || c.waiting) && inChannel(c) && (!q || `${c.name} ${c.company ?? ""} ${c.project ?? ""} ${c.externalId}`.toLowerCase().includes(q.toLowerCase())),
  );
  const mailboxes = (state?.accounts ?? []).filter((a) => a.kind === "email");
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

  async function summarize(convId: string) {
    setContextBusy(true);
    try {
      await api(`/api/conversations/${convId}`, { action: "context" });
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setContextBusy(false);
    }
  }

  // Write the context note when a chat is opened and the note is missing or older than the last message
  const stale = !!c && !!c.last && (!c.contextAt || c.contextAt < c.last.at);
  useEffect(() => {
    if (!c || !stale || !showContext || !state?.connections.gemini || contextAsked.current.has(c.id)) return;
    contextAsked.current.add(c.id);
    summarize(c.id);
  }, [c?.id, stale, showContext]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <div className="card grid h-[calc(100vh-104px)] min-h-[560px] grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        {/* List */}
        <div className="flex min-h-0 flex-col border-r border-[var(--line)]">
          <div className="space-y-2.5 p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input className="input !py-2 pl-9 text-[13.5px]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <button className="btn btn-dark !h-[38px] !px-3" title="New message to a WhatsApp group, contact or email" onClick={() => setComposing(true)}>
                <PenSquare size={15} />
              </button>
            </div>
            <div className="flex items-center gap-1">
              {(["all", "waiting"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-[12.5px] ${filter === f ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
                  {f === "all" ? "All" : `Waiting · ${state?.stats.waiting ?? 0}`}
                </button>
              ))}
              <select className="ml-auto max-w-[130px] rounded-md bg-transparent text-[12.5px] text-[var(--ink-2)] outline-none hover:bg-[var(--hover)]" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="all">All channels</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="groups">WhatsApp groups</option>
                <option value="email">Email</option>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.address}>
                    Email · {m.address}
                  </option>
                ))}
                <option value="team">Not clients (team, personal)</option>
              </select>
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
                      {x.last?.direction === "out" ? (x.repliedBy ? `${x.repliedBy.name}: ` : "You: ") : ""}
                      {x.last?.text}
                    </span>
                  </div>
                  {(x.repliedBy || x.internal) && (
                    <div className="mt-1">
                      {x.internal ? <Pill>Not a client</Pill> : <Pill tone="blue">Replied by {x.repliedBy!.name}</Pill>}
                    </div>
                  )}
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
            <div className="space-y-2.5 border-b border-[var(--line)] px-6 py-3.5">
              {/* Who + actions */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Avatar name={c.name} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {c.name}
                    {c.company && <span className="font-normal text-[var(--muted)]"> · {c.company}</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-[var(--ink-2)]">
                    <Channel c={c.channel} withLabel={false} />
                    {channelLine(c)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button className={`btn btn-sm ${selecting ? "btn-dark" : ""}`} onClick={startTask}>
                    <ListPlus size={14} /> {selecting ? `Create task from ${sel.size}` : "Create task"}
                  </button>
                  <button
                    className="btn btn-sm"
                    title={c.internal ? "Count this chat as a client again" : "Personal or team chat: never waiting, no reminders"}
                    onClick={() => action({ action: "internal", value: !c.internal }, c.internal ? "Back to client chats" : "Marked as not a client")}
                  >
                    {c.internal ? "It's a client" : "Not a client"}
                  </button>
                  {c.status === "handled" ? (
                    <button className="btn btn-sm" onClick={() => action({ action: "reopen" })}>
                      Reopen
                    </button>
                  ) : (
                    <button className="btn btn-sm" onClick={() => action({ action: "handled" }, "Marked as handled")}>
                      <CheckCheck size={14} /> Handled
                    </button>
                  )}
                </div>
              </div>

              {/* Settings for this client, as clear dropdowns */}
              <div className="flex flex-wrap items-center gap-2">
                <ChipSelect label="Project" value={c.project ?? ""} onChange={(v) => action({ action: "project", project: v }, "Project saved")}>
                  <option value="">None</option>
                  {[...new Set([...(board?.projects ?? []), c.project ?? ""])].filter(Boolean).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </ChipSelect>
                <ChipSelect
                  label="Remind after"
                  title="How long this client may wait before you're reminded"
                  value={String(c.remindAfter ?? "")}
                  onChange={(v) => action({ action: "remind_after", minutes: v === "" ? null : Number(v) }, "Reminder time saved")}
                >
                  {[...new Set([...REMIND, c.remindAfter ?? null])].map((m) => (
                    <option key={m ?? "d"} value={m ?? ""}>
                      {m === null ? "Default" : `${m} min`}
                    </option>
                  ))}
                </ChipSelect>
                {c.repliedBy && <Pill tone="blue">Reply sent by {c.repliedBy.name} · {ago(c.repliedBy.at, now)}</Pill>}
                {c.demo && <Pill>Test data</Pill>}
                {detail.links?.map((l) => {
                  const status = board?.tasks?.find((t) => t.id === l.task_id)?.status;
                  return (
                    <a
                      key={l.task_id}
                      href={l.url ?? undefined}
                      target="_blank"
                      title={`Task created ${ago(l.created_at, now)} from ${l.message_ids.length} message${l.message_ids.length === 1 ? "" : "s"}`}
                      className="inline-flex h-8 max-w-[280px] items-center gap-1.5 rounded-lg border border-[var(--line-2)] bg-white px-2.5 text-[12.5px] hover:bg-[var(--hover)]"
                    >
                      <ListPlus size={12} className="shrink-0 text-[var(--muted)]" />
                      <span className="truncate">{l.title}</span>
                      {status && <Pill tone={STATUS_TONE(status)}>{status}</Pill>}
                    </a>
                  );
                })}
              </div>
            </div>

            {/* What's going on in this chat, written by Gemini (can be hidden) */}
            {showContext ? (
              <div className="flex items-start gap-3 border-b border-[var(--line)] bg-[var(--bg)]/60 px-6 py-3">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    Context
                    {c.contextAt && <span className="normal-case tracking-normal">· {ago(c.contextAt, now)}</span>}
                  </div>
                  <p className="max-h-[120px] overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-2)]">
                    {contextBusy && !c.context ? "Reading the conversation…" : (c.context ?? "No summary yet.")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="btn btn-ghost btn-sm !px-2" title="Summarise again" disabled={contextBusy} onClick={() => summarize(c.id)}>
                    <RotateCw size={13} className={contextBusy ? "animate-spin" : ""} />
                  </button>
                  <button className="btn btn-sm" onClick={() => toggleContext(false)}>
                    <ChevronUp size={13} /> Hide
                  </button>
                </div>
              </div>
            ) : (
              <button className="flex w-full items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)]/60 px-6 py-1.5 text-left text-[12.5px] text-[var(--ink-2)] hover:bg-[var(--bg)]" onClick={() => toggleContext(true)}>
                <Sparkles size={13} className="text-[var(--muted)]" /> Context hidden
                <span className="ml-auto inline-flex items-center gap-1 font-medium text-[var(--ink)]">
                  <ChevronDown size={13} /> Show
                </span>
              </button>
            )}

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
                          {mine && c.channel === "whatsapp" && <Ticks status={m.status} />}
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
              <ReplyBox
                convId={c.id}
                value={reply}
                onChange={setReply}
                busy={busy}
                setBusy={setBusy}
                rows={2}
                onSubmit={() => doSend(reply)}
                placeholder={`Reply on ${CHANNELS[c.channel]?.label ?? c.channel}… or type / speak an instruction (e.g. “say Friday, tag @TuLab”) and press Generate`}
              />
              <div>
                <div className="flex items-center gap-1.5 pt-2">
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

      {composing && <Composer onClose={() => setComposing(false)} />}
      {drawer && detail && (
        <TaskDrawer
          messages={detail.messages.filter((m) => sel.has(m.id)).map(text)}
          messageIds={detail.messages.filter((m) => sel.has(m.id)).map((m) => m.id)}
          convId={c?.id}
          onCreated={() => {
            load();
            api<BoardLite>("/api/team?refresh=1").then(setBoard).catch(() => {});
          }}
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
