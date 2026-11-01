"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { api, useLive, type DraftRow } from "@/components/Live";
import { Avatar, Pill, ago } from "@/components/ui";
import FromPicker from "@/components/FromPicker";
import RecipientPicker, { type RecipientTarget } from "@/components/RecipientPicker";

// A teammate's update waiting for your approval. Nothing reaches the client until you approve and
// choose where it goes: back into the client's chat, or any WhatsApp group/contact or email.
export default function DraftCard({ d, now, inThread = false }: { d: DraftRow; now: number; inThread?: boolean }) {
  const { refresh, toast, state } = useLive();
  const conv = d.conv_id ? state?.conversations.find((c) => c.id === d.conv_id) : undefined;
  const [text, setText] = useState(d.text);
  const [mode, setMode] = useState<"reply" | "pick">(d.conv_id ? "reply" : "pick");
  const [from, setFrom] = useState("");
  const [target, setTarget] = useState<RecipientTarget | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: "approve" | "discard") {
    setBusy(true);
    try {
      const body = action === "discard" ? { action } : mode === "reply" ? { action, text, from } : { action, text, target };
      const r = await api<{ simulated?: boolean; name?: string; via?: string | null }>(`/api/drafts/${d.id}`, body);
      toast(action === "discard" ? "Update discarded" : `Sent${r.name ? ` to ${r.name}` : ""}${r.via ? ` from ${r.via}` : ""}${r.simulated ? " (test mode)" : ""}`);
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

  const ready = mode === "reply" ? !!d.conv_id : !!target;

  return (
    <div className={inThread ? "rounded-2xl border border-dashed border-[var(--line-2)] bg-[var(--bg)] p-4" : "py-4"}>
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <Avatar name={d.author} size={22} />
        <span className="min-w-0 flex-1 truncate">
          <b className="font-semibold">{d.author}</b>
          <span className="text-[var(--muted)]"> · {ago(d.created_at, now)}</span>
        </span>
        {d.project && <Pill>{d.project}</Pill>}
      </div>
      <textarea className="input min-h-[64px] resize-none text-[13.5px] leading-relaxed" rows={3} value={text} onChange={(e) => setText(e.target.value)} />

      <div className="mt-2.5 space-y-2">
        {d.conv_id && (
          <div className="flex gap-1 text-[12.5px]">
            <button onClick={() => setMode("reply")} className={`rounded-full px-2.5 py-0.5 ${mode === "reply" ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
              Reply to {d.conv_name ?? "client"}
            </button>
            <button onClick={() => setMode("pick")} className={`rounded-full px-2.5 py-0.5 ${mode === "pick" ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
              Send somewhere else
            </button>
          </div>
        )}
        {mode === "reply" && conv && <FromPicker channel={conv.channel} account={conv.account} value={from} onChange={setFrom} />}
        {mode === "pick" && <RecipientPicker value={target} onChange={setTarget} />}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={polish}>
          <Sparkles size={13} /> Polish
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("discard")}>
          Discard
        </button>
        <button className="btn btn-dark btn-sm ml-auto" disabled={busy || !text.trim() || !ready} onClick={() => act("approve")}>
          Approve & send
        </button>
      </div>
    </div>
  );
}
