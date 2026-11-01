"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Mic, RotateCw, Sparkles } from "lucide-react";
import type { ConvSummary } from "@/lib/store";
import { accountOf, api, useLive } from "@/components/Live";
import { Avatar, Channel, Waiting } from "@/components/ui";

export const ackText = (name: string) => `Hi ${name.split(" ")[0]}, we've received your message and we're on it. I'll update you shortly.`;

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
    <div className={compact ? "py-4" : "card p-5"}>
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

          <p className={`mt-3 leading-relaxed text-[var(--ink)] ${compact ? "line-clamp-2 text-[13.5px]" : "text-[15px]"}`} dir="auto">
            {c.last?.kind === "voice" && <Mic size={14} className="mr-1 inline -translate-y-px text-[var(--muted)]" />}
            {c.last?.text}
          </p>

          <div className="mt-3.5 rounded-xl bg-[var(--bg)] px-3.5 py-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="eyebrow inline-flex items-center gap-1.5">
                <Sparkles size={12} /> Suggested reply
              </span>
              <button className="btn btn-ghost btn-sm !h-6 !px-1.5" title="Write another suggestion" disabled={busy} onClick={regenerate}>
                <RotateCw size={12} className={busy ? "animate-spin" : ""} />
              </button>
            </div>
            {editing ? (
              <textarea autoFocus className="input min-h-[72px] resize-none text-[14px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
            ) : (
              <p onClick={() => setEditing(true)} className="cursor-text text-[14px] leading-relaxed text-[var(--ink-2)]" title="Click to edit">
                {text || (state?.connections.gemini ? <span className="text-[var(--muted)]">Writing a suggestion…</span> : <span className="text-[var(--muted)]">Click to write a reply</span>)}
              </p>
            )}
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
