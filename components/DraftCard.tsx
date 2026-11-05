"use client";
import { useMemo, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { api, useLive, type DraftRow } from "@/components/Live";
import { Avatar, Pill, ago } from "@/components/ui";
import FromPicker from "@/components/FromPicker";
import RecipientPicker, { type RecipientTarget } from "@/components/RecipientPicker";

// A teammate's update waiting for your approval. Nothing reaches the client until you approve and
// choose where it goes: back into the client's chat, or any WhatsApp group/contact or email.
export default function DraftCard({ d, now, inThread = false }: { d: DraftRow; now: number; inThread?: boolean }) {
  const { refresh, toast, state } = useLive();
  const conv = d.conv_id ? state?.conversations.find((c) => c.id === d.conv_id) : undefined;
  // An update about a ClickUp task goes on that task as a comment: no channel, no recipient, no quoting
  const onTask = conv?.channel === "clickup";
  const [text, setText] = useState(d.text);
  const [mode, setMode] = useState<"reply" | "pick">(d.conv_id ? "reply" : "pick");
  const [from, setFrom] = useState("");
  const [target, setTarget] = useState<RecipientTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState("");

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

  // No instruction = polish; with one = rewrite the way you asked (e.g. "shorter, mention Friday deadline")
  async function improve() {
    setBusy(true);
    try {
      const body = instruction.trim() ? { mode: "rewrite", text, instructions: instruction.trim() } : { mode: "polish", text };
      setText((await api<{ text: string }>("/api/ai", body)).text);
      setInstruction("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === "reply" ? !!d.conv_id : !!target;
  // Trailing punctuation is left out of the link: "see https://x.com/a." is a link and a full stop.
  const links = useMemo(() => [...new Set((text.match(/https?:\/\/[^\s<>"']+/g) ?? []).map((u) => u.replace(/[).,;:!?\]]+$/, "")))], [text]);

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
      {/* The update stays editable, so it lives in a textarea, where a link is just characters. Any
          link in it is listed here as well, to be opened and checked before the update is approved. */}
      {links.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <span className="text-[var(--muted)]">{links.length > 1 ? "Links" : "Link"}:</span>
          {links.map((u) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noreferrer"
              title={u}
              className="inline-flex max-w-[260px] items-center gap-1 truncate text-[var(--blue)] underline underline-offset-2 hover:opacity-80"
            >
              <ExternalLink size={12} className="shrink-0" />
              <span className="truncate">{u.replace(/^https?:\/\//, "")}</span>
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        <input
          className="input !h-8 !py-0 text-[13px]"
          dir="auto"
          placeholder="Rewrite instruction, e.g. shorter, more formal, add the Friday deadline"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && instruction.trim() && !busy && improve()}
        />
        <button className="btn btn-sm shrink-0" disabled={busy || !text.trim()} onClick={improve}>
          <Sparkles size={13} /> {instruction.trim() ? "Rewrite" : "Polish"}
        </button>
      </div>

      <div className="mt-2.5 space-y-2">
        {d.conv_id && (
          <div className="flex gap-1 text-[12.5px]">
            <button onClick={() => setMode("reply")} className={`rounded-full px-2.5 py-0.5 ${mode === "reply" ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
              {onTask ? "Post on the task" : `Reply to ${d.conv_name ?? "client"}`}
            </button>
            <button onClick={() => setMode("pick")} className={`rounded-full px-2.5 py-0.5 ${mode === "pick" ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
              Send somewhere else
            </button>
          </div>
        )}
        {mode === "reply" && onTask && <p className="text-[12.5px] text-[var(--muted)]">Goes on the ClickUp task “{conv?.name}” as a comment.</p>}
        {mode === "reply" && conv && !onTask && <FromPicker channel={conv.channel} account={conv.account} value={from} onChange={setFrom} />}
        {mode === "pick" && <RecipientPicker value={target} onChange={setTarget} />}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("discard")}>
          Discard
        </button>
        <button className="btn btn-dark btn-sm ml-auto" disabled={busy || !text.trim() || !ready} onClick={() => act("approve")}>
          {onTask && mode === "reply" ? "Approve & post on the task" : "Approve & send"}
        </button>
      </div>
    </div>
  );
}
