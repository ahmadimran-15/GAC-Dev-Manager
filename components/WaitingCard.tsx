"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Mic, RotateCw, Sparkles, Square } from "lucide-react";
import { VOICE_LANGS, useVoice } from "@/lib/use-voice";
import type { ConvSummary } from "@/lib/store";
import { accountOf, api, useLive } from "@/components/Live";
import { Avatar, Channel, Waiting } from "@/components/ui";
import MessageText from "@/components/MessageText";

export const ackText = (name: string) => `Hi ${name.split(" ")[0]}, we've received your message and we're on it. I'll update you shortly.`;

// The reply text box with voice input and "Generate": whatever is in the box (a draft or an
// instruction, typed or spoken) is turned into the finished message by Gemini. "@Name" tags people.
export function ReplyBox({
  convId,
  value,
  onChange,
  busy,
  setBusy,
  placeholder,
  rows = 3,
  onSubmit,
}: {
  convId: string;
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  placeholder?: string;
  rows?: number;
  onSubmit?: () => void;
}) {
  const { toast, state } = useLive();
  const [lang, setLang] = useState("en-US");
  const latest = useRef(value);
  latest.current = value;
  // While Generate runs, late speech must not be appended to the generated reply
  const generating = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const voice = useVoice((t) => !generating.current && onChange(latest.current ? `${latest.current} ${t}` : t), !!state?.connections.voiceWhisper);

  async function generate() {
    // Stop the mic first and include what was just being said
    const input = voice.interim && voice.interim !== "Transcribing…" ? `${value} ${voice.interim}`.trim() : value;
    generating.current = true;
    if (voice.listening) voice.stop();
    abort.current = new AbortController();
    setRunning(true);
    setBusy(true);
    try {
      onChange((await api<{ text: string }>(`/api/conversations/${convId}`, { action: "generate", input }, abort.current.signal)).text);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setBusy(false);
      setRunning(false);
      generating.current = false;
      abort.current = null;
    }
  }

  return (
    <div className="rounded-xl border border-[var(--line-2)] bg-white focus-within:border-[#a8a8a2]">
      <textarea
        dir="auto"
        rows={rows}
        className="w-full resize-none rounded-xl bg-transparent px-3 pt-2.5 text-[14px] leading-relaxed outline-none placeholder:text-[var(--muted)]"
        placeholder={placeholder}
        value={voice.interim ? `${value} ${voice.interim}` : value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => onSubmit && (e.ctrlKey || e.metaKey) && e.key === "Enter" && onSubmit()}
      />
      <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
        <button
          className={`grid h-7 w-7 place-items-center rounded-full ${voice.listening ? "pulse-ring bg-[var(--red)] text-white" : "bg-[#171717] text-white"}`}
          title={voice.listening ? "Stop" : "Speak"}
          onClick={() => (voice.listening ? voice.stop() : voice.start(lang))}
        >
          {voice.listening ? <Square size={10} fill="currentColor" /> : <Mic size={13} />}
        </button>
        {VOICE_LANGS.map((l) => (
          <button key={l.code} onClick={() => setLang(l.code)} className={`shrink-0 whitespace-nowrap rounded-full px-2 text-[11.5px] ${lang === l.code ? "bg-[var(--hover)] font-medium" : "text-[var(--muted)]"}`}>
            {l.label}
          </button>
        ))}
        {running ? (
          <button className="btn btn-sm ml-auto" onClick={() => abort.current?.abort()} title="Stop generating; your text stays in the box">
            <Loader2 size={13} className="animate-spin" /> Stop
          </button>
        ) : (
          <button className="btn btn-sm ml-auto" disabled={busy || !state?.connections.gemini} onClick={generate} title="Turn what's in the box into the finished reply">
            <Sparkles size={13} /> Generate
          </button>
        )}
      </div>
    </div>
  );
}

// A client waiting for a reply, with Gemini's suggested answer ready to send.
export default function WaitingCard({ c, now, compact = false, onDone }: { c: ConvSummary; now: number; compact?: boolean; onDone?: () => void }) {
  const { send, refresh, toast, state } = useLive();
  const [text, setText] = useState(c.suggestion ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setText(c.suggestion ?? "");
  }, [c.suggestion, editing]);

  async function regenerate() {
    setBusy(true);
    try {
      const r = await api<{ suggestion: string }>(`/api/conversations/${c.id}`, { action: "suggest" });
      setText(r.suggestion);
      setEditing(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doSend(t: string, ack = false) {
    setBusy(true);
    if (await send(c.id, t, ack)) onDone?.();
    setBusy(false);
  }

  async function handled() {
    await api(`/api/conversations/${c.id}`, { action: "handled" });
    toast(`${c.name} marked as handled`);
    refresh();
    onDone?.();
  }

  return (
    <div className={compact ? "py-4" : "card p-4 md:p-5"}>
      <div className="flex items-start gap-3">
        <Avatar name={c.name} size={compact ? 30 : 38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate">
              <span className="font-semibold">{c.name}</span>
              {c.company && <span className="text-[var(--muted)]"> · {c.company}</span>}
            </div>
            {c.waitingSince && <Waiting since={c.waitingSince} now={now} />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-[var(--muted)]">
            <Channel c={c.channel} account={accountOf(state?.accounts, c.account)?.label ?? (c.channel === "email" ? c.account : null)} />
            {c.project && <span>{c.project}</span>}
            {c.unanswered > 1 && <span>{c.unanswered} messages</span>}
          </div>

          <div className={`mt-3 leading-relaxed text-[var(--ink)] ${compact ? "line-clamp-3 text-[13.5px]" : "max-h-[16rem] overflow-y-auto text-[15px]"}`}>
            {c.last?.kind === "voice" && <Mic size={14} className="mr-1 inline -translate-y-px text-[var(--muted)]" />}
            <MessageText text={c.last?.text ?? ""} />
          </div>

          <div className="mt-3.5 rounded-xl bg-[var(--bg)] px-3.5 py-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="eyebrow inline-flex items-center gap-1.5">
                <Sparkles size={12} /> {c.suggestion && text === c.suggestion ? "Suggested reply" : "Your reply"}
              </span>
              <button className="btn btn-ghost btn-sm !h-6 !px-1.5" title="Write another suggestion" disabled={busy} onClick={regenerate}>
                <RotateCw size={12} className={busy ? "animate-spin" : ""} />
              </button>
            </div>
            <ReplyBox
              convId={c.id}
              value={text}
              onChange={(v) => (setText(v), setEditing(true))}
              busy={busy}
              setBusy={setBusy}
              placeholder={state?.connections.gemini && !c.suggestion ? "Writing a suggestion… or type / speak what to say, then Generate" : "Type or speak a reply, or an instruction like “tell him Friday, tag @TuLab”, then Generate"}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn btn-dark btn-sm" disabled={busy || !text.trim()} onClick={() => doSend(text.trim())}>
              Send reply
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => doSend(ackText(c.name), true)} title={ackText(c.name)}>
              Acknowledge
            </button>
            {!compact && (
              <Link href={`/inbox?c=${c.id}`} className="btn btn-ghost btn-sm">
                Open chat
              </Link>
            )}
            <button className="btn btn-ghost btn-sm ml-auto" onClick={handled}>
              Mark handled
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
