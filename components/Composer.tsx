"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { api, useLive } from "@/components/Live";
import RecipientPicker, { type RecipientTarget } from "@/components/RecipientPicker";

// New message to anyone: WhatsApp group or contact, or an email address.
export default function Composer({ onClose }: { onClose: () => void }) {
  const { toast, refresh } = useLive();
  const router = useRouter();
  const [target, setTarget] = useState<RecipientTarget | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "polish" | "send">("");

  async function polish() {
    setBusy("polish");
    try {
      setText((await api<{ text: string }>("/api/ai", { mode: "polish", text })).text);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setBusy("");
    }
  }

  async function send() {
    if (!target) return;
    setBusy("send");
    try {
      const r = await api<{ convId: string; via: string | null }>("/api/send-to", { ...target, text });
      toast(`Sent to ${target.toName}${r.via ? ` from ${r.via}` : ""}`);
      await refresh();
      onClose();
      router.push(`/inbox?c=${r.convId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Send failed", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center bg-black/20 px-4 pt-[10vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="pop-in w-full max-w-[600px] rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[16px] font-semibold">New message</div>
          <button className="btn btn-ghost !h-8 !w-8 !p-0" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <RecipientPicker value={target} onChange={setTarget} />
        <textarea dir="auto" className="input mt-3 min-h-[120px] leading-relaxed" placeholder="Write your message…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-3 flex items-center justify-between">
          <button className="btn btn-ghost btn-sm" disabled={!!busy || !text.trim()} onClick={polish}>
            {busy === "polish" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Polish
          </button>
          <button className="btn btn-dark" disabled={!!busy || !target || !text.trim()} onClick={send}>
            {busy === "send" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
