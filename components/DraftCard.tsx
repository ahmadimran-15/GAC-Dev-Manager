"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { api, useLive, type DraftRow } from "@/components/Live";
import { Avatar, ago } from "@/components/ui";

// A teammate's reply waiting for your approval. Nothing reaches the client until you approve.
export default function DraftCard({ d, now, inThread = false }: { d: DraftRow; now: number; inThread?: boolean }) {
  const { refresh, toast, state } = useLive();
  const [text, setText] = useState(d.text);
  const [target, setTarget] = useState(d.conv_id ?? "");
  const [busy, setBusy] = useState(false);

  async function act(action: "approve" | "discard") {
    setBusy(true);
    try {
      const r = await api<{ simulated?: boolean }>(`/api/drafts/${d.id}`, { action, text, conv_id: target });
      toast(action === "discard" ? "Draft discarded" : `Sent${r.simulated ? " (test mode, not delivered)" : ""}`);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function polish() {
    setBusy(true);
    try {
      setText((await api<{ text: string }>("/api/ai", { mode: "polish", text })).text);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={inThread ? "rounded-2xl border border-dashed border-[var(--line-2)] bg-[var(--bg)] p-4" : "py-4"}>
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <Avatar name={d.author} size={22} />
        <span className="min-w-0 flex-1 truncate">
          <b className="font-semibold">{d.author}</b>
          <span className="text-[var(--muted)]"> {d.conv_name && !inThread ? `→ ${d.conv_name}` : "wrote a reply"} · {ago(d.created_at, now)}</span>
        </span>
      </div>
      {!d.conv_id && (
        <select className="input mb-2 !py-1.5 text-[13px]" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Send to which client?</option>
          {state?.conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.project ? `· ${c.project}` : ""}
            </option>
          ))}
        </select>
      )}
      <textarea className="input min-h-[64px] resize-none text-[13.5px] leading-relaxed" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex items-center gap-1.5">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={polish}>
          <Sparkles size={13} /> Polish
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("discard")}>
          Discard
        </button>
        <button className="btn btn-dark btn-sm ml-auto" disabled={busy || !text.trim() || (!d.conv_id && !target)} onClick={() => act("approve")}>
          Approve & send
        </button>
      </div>
    </div>
  );
}
