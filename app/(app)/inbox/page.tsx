"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, CheckCheck, ChevronDown, ChevronUp, ExternalLink, ListPlus, Loader2, Mic, PenSquare, RotateCw, Search, Send, Sparkles, X } from "lucide-react";
import Composer from "@/components/Composer";
import MessageText, { plainText } from "@/components/MessageText";
import type { ConvSummary, Message } from "@/lib/store";
import { api, useLive, type DraftRow } from "@/components/Live";
import { Avatar, CHANNELS, Channel, Pill, STATUS_TONE, Ticks, Waiting, ago } from "@/components/ui";
import DraftCard from "@/components/DraftCard";
import TeamUpdates from "@/components/TeamUpdates";
import TaskDrawer, { type BoardLite } from "@/components/TaskDrawer";
import { ReplyBox, ackText } from "@/components/WaitingCard";
import { ListSkeleton, ThreadSkeleton } from "@/components/Skeleton";
import FromPicker from "@/components/FromPicker";
import Dropdown from "@/components/Dropdown";
import { accountOf } from "@/components/Live";

interface Detail {
  conversation: ConvSummary & { subject: string | null };
  messages: Message[];
  drafts: DraftRow[];
  links: { task_id: string; title: string; url: string | null; project: string | null; message_ids: string[]; created_at: number }[];
}

const REMIND = [null, 5, 15, 30, 60] as const;

// A voice note is never transcribed on its own: press this and only this one is fetched and read.
function Transcribe({ id, dark, onDone }: { id: string; dark: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (err)
    return (
      <span className={`text-[13px] ${dark ? "text-white/70" : "text-[var(--red)]"}`}>
        {err}{" "}
        <button className="underline underline-offset-2" onClick={() => setErr("")}>
          try again
        </button>
      </span>
    );
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] transition ${dark ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-[var(--ink-2)] hover:text-[var(--ink)]"} disabled:opacity-60`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/messages/${id}/transcribe`, {});
          onDone();
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Couldn't transcribe it");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {busy ? "Reading the voice note…" : "Transcribe"}
    </button>
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

// side = which inbox this is: the company's client accounts, or the accounts marked as your team's.
// Every link inside keeps the side in the URL, so opening a chat doesn't drop you back to Clients.
function Inbox({ side }: { side: "client" | "team" }) {
  const sideUrl = (convId?: string) => `/inbox?${[side === "team" ? "tab=myteam" : "", convId ? `c=${convId}` : ""].filter(Boolean).join("&")}`;
  const params = useSearchParams();
  const router = useRouter();
  const { state, refresh, send, toast } = useLive();
  const [filter, setFilter] = useState<"all" | "waiting">("all");
  const [proj, setProj] = useState(""); // filter the chats by ClickUp project
  const [channel, setChannel] = useState("all");
  const [contextBusy, setContextBusy] = useState(false);
  const contextAsked = useRef<Set<string>>(new Set());
  // Which chats you've opened since their last client message (remembered in this browser)
  const [seen, setSeen] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem("gac_seen") ?? "{}"));
    } catch {}
  }, []);
  const isUnread = (x: ConvSummary) => !!x.last && x.last.direction === "in" && (seen[x.id] ?? 0) < x.last.at;

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
  // "Waiting" means a person is waiting on you. A ClickUp task thread is our own work, counted separately.
  const needsReply = (c: ConvSummary) => c.waiting && c.channel !== "clickup";
  // "whatsapp", "groups", "email", "team", or one mailbox / number (an account key)
  const inChannel = (c: ConvSummary) =>
    channel === "all" ||
    (channel === "groups"
      ? isGroup(c)
      : channel === "tasks"
        ? c.channel === "clickup"
        : channel === "team"
          ? c.internal && c.channel !== "clickup"
          : channel === "whatsapp" || channel === "email"
            ? c.channel === channel
            : c.account.toLowerCase() === channel.toLowerCase());
  const convs = (state?.conversations ?? [])
    .filter(
      (c) =>
        c.audience === side &&
        (filter === "all" || needsReply(c)) &&
        inChannel(c) &&
        (!proj || c.project === proj) &&
        (!q || `${c.name} ${c.company ?? ""} ${c.project ?? ""} ${c.externalId}`.toLowerCase().includes(q.toLowerCase())),
    )
    // Newest first: the chat that spoke last sits at the top
    .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  const sideConvs = (state?.conversations ?? []).filter((c) => c.audience === side);
  const projects = [...new Set(sideConvs.map((c) => c.project).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const mailboxes = (state?.accounts ?? []).filter((a) => a.kind === "email");
  const id = params.get("c") ?? convs[0]?.id ?? null;
  // Phone: one pane at a time, the list until a chat is tapped, then the chat with a back arrow
  const chosen = !!params.get("c");
  const now = state?.now ?? Date.now();

  // Opening a chat marks it as seen up to its latest message
  const openedLast = (state?.conversations ?? []).find((x) => x.id === id)?.last?.at ?? 0;
  useEffect(() => {
    if (!id || !openedLast || (seen[id] ?? 0) >= openedLast) return;
    const next = { ...seen, [id]: openedLast };
    setSeen(next);
    try {
      localStorage.setItem("gac_seen", JSON.stringify(next));
    } catch {}
  }, [id, openedLast]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // In a one-to-one chat the messages since your last reply are the obvious unit, so they start ticked.
      // In a group (or a long run with no reply of ours) that would tick the whole thread, so nothing starts
      // ticked and you pick what belongs in the task.
      const lastOut = [...detail.messages].reverse().find((m) => m.direction === "out")?.created_at ?? 0;
      const since = detail.messages.filter((m) => m.direction === "in" && m.created_at > lastOut);
      setSel(new Set(isGroup(c!) || since.length > 5 ? [] : since.map((m) => m.id)));
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
    <div className="md:pb-6">
      <div className="card grid h-[calc(100dvh-168px-env(safe-area-inset-bottom))] grid-cols-1 overflow-hidden max-md:!rounded-none max-md:!border-0 md:h-[calc(100vh/var(--ui-zoom)-152px)] md:min-h-[560px] md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
        {/* List */}
        <div className={`min-h-0 flex-col border-r border-[var(--line)] ${chosen ? "hidden md:flex" : "flex"}`}>
          <div className="space-y-2.5 p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input className="input !py-2 !pl-9 text-[13.5px]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <button className="btn btn-dark !h-[38px] !px-3" title="New message to a WhatsApp group, contact or email" onClick={() => setComposing(true)}>
                <PenSquare size={15} />
              </button>
            </div>
            {/* All / Waiting, then the two filters on their own line so nothing collides in a narrow list */}
            <div className="flex items-center gap-1">
              {(["all", "waiting"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] ${filter === f ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
                  {f === "all" ? "All" : "Waiting"}
                  <span className={`tnum ml-1 ${filter === f ? "text-white/70" : "text-[var(--muted)]"}`}>{f === "all" ? sideConvs.length : sideConvs.filter(needsReply).length}</span>
                </button>
              ))}
              {(proj || channel !== "all") && (
                <button
                  className="ml-auto shrink-0 whitespace-nowrap text-[12px] text-[var(--muted)] hover:text-[var(--ink)]"
                  onClick={() => {
                    setProj("");
                    setChannel("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <Dropdown
                block
                value={proj}
                onChange={setProj}
                options={[{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p, label: p, hint: `${sideConvs.filter((c) => c.project === p).length}` }))]}
              />
              <Dropdown
                block
                align="right"
                value={channel}
                onChange={setChannel}
                options={[
                  { value: "all", label: "All channels" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "groups", label: "WhatsApp groups" },
                  { value: "email", label: "Email" },
                  { value: "tasks", label: `ClickUp tasks${state?.stats.tasks ? ` · ${state.stats.tasks}` : ""}`, hint: "task comments" },
                  ...mailboxes.map((m) => ({ value: m.address, label: m.address, hint: "mailbox" })),
                  { value: "team", label: "Not clients", hint: "team, personal" },
                ]}
              />
            </div>
          </div>
          <div className="scroll min-h-0 flex-1 px-2 pb-2">
            {convs.map((x) => {
              const open = x.id === id;
              const unread = !open && isUnread(x);
              return (
              <button
                key={x.id}
                onClick={() => router.replace(sideUrl(x.id))}
                className={`relative flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  open ? "bg-white shadow-[0_0_0_1px_var(--line-2),0_2px_8px_-4px_rgba(0,0,0,0.12)]" : "hover:bg-[var(--bg)]/70"
                }`}
              >
                {open && <span className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full bg-[#171717]" />}
                <Avatar name={x.name} size={36} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  {/* Name, then how long they've waited — never wrapped */}
                  <div className="flex items-baseline gap-2">
                    <span className={`flex min-w-0 flex-1 items-center gap-1.5 text-[14px] leading-snug ${x.waiting || unread ? "font-semibold" : ""}`}>
                      {unread && <span className="dot shrink-0" style={{ background: "#1d63b5" }} title="New since you last opened it" />}
                      <span className="truncate">{x.name}</span>
                    </span>
                    {x.waiting && x.waitingSince ? (
                      <Waiting since={x.waitingSince} now={now} />
                    ) : (
                      <span className="shrink-0 whitespace-nowrap text-[11.5px] text-[var(--muted)]">{x.last ? ago(x.last.at, now) : ""}</span>
                    )}
                  </div>
                  {/* The channel, and for a task its project */}
                  <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
                    <Channel c={x.channel} withLabel={false} />
                    {(x.project || x.company) && <span className="truncate">{x.project ?? x.company}</span>}
                    {x.internal && <Pill>Not a client</Pill>}
                    {x.repliedBy && <Pill tone="blue">{x.repliedBy.name} replied</Pill>}
                  </div>
                  <div className={`truncate text-[13px] leading-snug ${x.waiting || unread ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                    {x.last?.direction === "out" ? (x.repliedBy ? (String(x.last.text ?? "").startsWith(`${x.repliedBy.name}: `) ? "" : `${x.repliedBy.name}: `) : "You: ") : ""}
                    {plainText(x.last?.text)}
                  </div>
                </div>
              </button>
              );
            })}
            {!state && <ListSkeleton />}
            {state && !convs.length && <div className="p-8 text-center text-[13px] text-[var(--muted)]">No conversations</div>}
          </div>
        </div>

        {/* Thread */}
        {c ? (
          <div className={`min-h-0 flex-col ${chosen ? "flex" : "hidden md:flex"}`}>
            <div className="space-y-2.5 border-b border-[var(--line)] px-4 py-3 md:px-6 md:py-3.5">
              {/* Who + actions */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button className="btn btn-ghost !h-9 !w-9 shrink-0 !p-0 md:hidden" title="All chats" onClick={() => router.replace(sideUrl())}>
                  <ArrowLeft size={18} />
                </button>
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
                  {c.channel === "clickup" && (
                    <a href={`https://app.clickup.com/t/${c.externalId}`} target="_blank" className="btn btn-sm" title="Open this task in ClickUp, with all its comments">
                      Open task <ExternalLink size={13} />
                    </a>
                  )}
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
                <Dropdown
                  label="Project"
                  value={c.project ?? ""}
                  onChange={(v) => action({ action: "project", project: v }, "Project saved")}
                  options={[{ value: "", label: "None" }, ...[...new Set([...(board?.projects ?? []), c.project ?? ""])].filter(Boolean).map((p) => ({ value: p, label: p }))]}
                />
                <Dropdown
                  label="Remind after"
                  title="How long this client may wait before you're reminded"
                  value={String(c.remindAfter ?? "")}
                  onChange={(v) => action({ action: "remind_after", minutes: v === "" ? null : Number(v) }, "Reminder time saved")}
                  options={[...new Set([...REMIND, c.remindAfter ?? null])].map((m) => ({ value: m === null ? "" : String(m), label: m === null ? "Default" : `${m} min` }))}
                />
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
              <div className="flex items-start gap-3 border-b border-[var(--line)] bg-[var(--bg)]/60 px-4 py-3 md:px-6">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    Context
                    {c.contextAt && <span className="normal-case tracking-normal">· {ago(c.contextAt, now)}</span>}
                  </div>
                  <p className="max-h-[4.2rem] overflow-y-auto whitespace-pre-wrap text-[13px] md:max-h-[120px] leading-relaxed text-[var(--ink-2)]">
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
              <button className="flex w-full items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)]/60 px-4 py-1.5 text-left md:px-6 text-[12.5px] text-[var(--ink-2)] hover:bg-[var(--bg)]" onClick={() => toggleContext(true)}>
                <Sparkles size={13} className="text-[var(--muted)]" /> Context hidden
                <span className="ml-auto inline-flex items-center gap-1 font-medium text-[var(--ink)]">
                  <ChevronDown size={13} /> Show
                </span>
              </button>
            )}

            {selecting && (
              <div className="flex flex-wrap items-center gap-2 bg-[var(--bg)] px-4 py-2 text-[13px] text-[var(--ink-2)] md:px-6">
                <span className="min-w-0 flex-1">Tick the messages that belong in this task. {sel.size > 0 && <b className="font-semibold text-[var(--ink)]">{sel.size} ticked</b>}</span>
                <button
                  className="shrink-0 text-[12.5px] hover:text-[var(--ink)]"
                  onClick={() => setSel(sel.size ? new Set() : new Set(detail.messages.filter((m) => m.direction === "in").map((m) => m.id)))}
                >
                  {sel.size ? "Clear" : "Tick all from them"}
                </button>
                <button className="btn btn-ghost btn-sm shrink-0" onClick={() => (setSelecting(false), setSel(new Set()))}>
                  <X size={13} /> Cancel
                </button>
              </div>
            )}

            <div className="scroll min-h-0 flex-1 px-3 py-4 md:px-6 md:py-5">
              {detail.messages.map((m, i) => {
                // A teammate (team number) writing in the group from their own phone: counts as our reply,
                // but it's their message, so it sits on the left with their name, like in WhatsApp
                const byTeammate = m.direction === "out" && !!m.sent_by && !["me", "phone"].includes(m.sent_by) && (m.text ?? "").startsWith(`${m.sent_by}: `);
                const mine = m.direction === "out" && !byTeammate;
                const body = byTeammate ? text(m).slice(m.sent_by!.length + 2) : text(m);
                // Who wrote it: a teammate in a group, or the person who left this ClickUp comment
                const author = !mine && !byTeammate && m.sent_by && !["me", "phone"].includes(m.sent_by) ? m.sent_by : null;
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
                      <div className={`max-w-[85%] md:max-w-[70%] ${mine ? "items-end text-right" : ""} flex flex-col`}>
                        <div
                          dir="auto"
                          onClick={() => !mine && selecting && toggle(m.id)}
                          className={`inline-block whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-left text-[14px] leading-relaxed ${
                            mine
                              ? m.ack
                                ? "rounded-br-md border border-[var(--line-2)] bg-white text-[var(--ink-2)]"
                                : "rounded-br-md bg-[#171717] text-white"
                              : `rounded-bl-md ${byTeammate ? "bg-[#eaf2fb]" : "bg-[var(--bg)]"} text-[var(--ink)] ${picked ? "ring-2 ring-[#171717]" : ""} ${selecting ? "cursor-pointer" : ""}`
                          }`}
                        >
                          {byTeammate && <div className="mb-0.5 text-[12px] font-semibold text-[var(--blue)]">{m.sent_by} · team</div>}
                          {author && (
                            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
                              <Avatar name={author} size={18} /> {author}
                            </div>
                          )}
                          {m.kind === "voice" && (
                            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]">
                              <Mic size={13} /> Voice note
                            </div>
                          )}
                          {m.kind === "voice" && m.media_path && <audio controls src={`/api/media/${m.media_path}`} className="mb-2 h-9 w-64 max-w-full" />}
                          {body ? <MessageText text={body} dark={mine && !m.ack} /> : m.kind === "voice" ? <Transcribe id={m.id} dark={mine && !m.ack} onDone={load} /> : null}
                        </div>
                        <div className="mt-1 px-1 text-[11px] text-[var(--muted)]">
                          {mine && m.ack ? "Acknowledged · " : ""}
                          {mine && m.sent_by && m.sent_by !== "me" ? `${m.sent_by === "phone" ? "From your phone" : `Written by ${m.sent_by}`} · ` : ""}
                          {m.via && !byTeammate ? `${c.channel === "clickup" ? "on" : mine ? "from" : "to"} ${m.via} · ` : ""}
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

            <div className="border-t border-[var(--line)] px-3 py-3 md:px-6 md:py-4">
              {c.waiting && c.suggestion && !reply && (
                <div className="mb-3 flex items-start gap-3 rounded-xl bg-[var(--bg)] px-3 py-2.5 md:px-4 md:py-3">
                  <Sparkles size={14} className="mt-1 shrink-0 text-[var(--muted)]" />
                  <p className="flex-1 text-[13.5px] leading-relaxed text-[var(--ink-2)] max-md:line-clamp-2">{c.suggestion}</p>
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
                placeholder={`Reply on ${CHANNELS[c.channel]?.label ?? c.channel}… or type / speak an instruction (e.g. “say Friday, tag @Tulaib”) and press Generate`}
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
          state?.conversations.length === 0 ? <div className="hidden place-items-center text-[var(--muted)] md:grid">No conversations yet</div> : <div className={chosen ? "" : "hidden md:block"}><ThreadSkeleton /></div>
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

// Two inboxes and the approvals queue: client chats (the company's client numbers and mailboxes),
// your team's chats (the accounts you marked as the team's, in Settings), and updates to approve.
function InboxTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const { state } = useLive();
  // A link from elsewhere (Overview, a task's Reply button) only carries ?c=…, so the chat itself says
  // which side to open: a team chat opens the My team inbox, not Clients.
  const openId = params.get("c");
  const openSide = openId ? (state?.conversations ?? []).find((c) => c.id === openId)?.audience : undefined;
  const which = params.get("tab") ?? (openSide === "team" ? "myteam" : "");
  const tab = (on: boolean) => `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13.5px] transition ${on ? "bg-white font-medium text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]"}`;
  const dot = (n: number, tone: string) => n > 0 && <span className={`tnum rounded-full px-1.5 text-[10.5px] font-semibold text-white ${tone}`}>{n}</span>;
  const teamChats = (state?.conversations ?? []).filter((c) => c.audience === "team").length;
  return (
    <div className="mx-auto w-full md:px-6 md:pt-4 xl:px-10">
      <div className="flex flex-wrap items-center gap-1 px-4 py-2 md:mb-3 md:px-0 md:py-0">
        <button className={tab(which === "")} onClick={() => router.replace("/inbox")}>
          Clients
          {dot(state?.stats.waiting ?? 0, "bg-[var(--red)]")}
        </button>
        <button className={tab(which === "myteam")} onClick={() => router.replace("/inbox?tab=myteam")} title="Chats on the number or mailbox you marked as your team's">
          My team
          {dot(state?.stats.teamWaiting ?? 0, "bg-[var(--red)]") || (teamChats > 0 && <span className="tnum text-[11px] text-[var(--muted)]">{teamChats}</span>)}
        </button>
        <button className={tab(which === "team")} onClick={() => router.replace("/inbox?tab=team")}>
          Team updates
          {dot(state?.drafts.length ?? 0, "bg-[var(--amber)]")}
        </button>
      </div>
      {which === "team" ? <TeamUpdates /> : <Inbox side={which === "myteam" ? "team" : "client"} />}
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense>
      <InboxTabs />
    </Suspense>
  );
}
