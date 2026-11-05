"use client";
import { useEffect, useRef } from "react";
import { type LucideIcon } from "lucide-react";

// Asks before something you cannot take back, in the dashboard's own style rather than the browser's
// grey box. Escape or the backdrop cancels, Enter confirms, and the confirm button holds the focus so
// a keyboard answer works without reaching for the mouse.

export default function Confirm({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  Icon,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "normal";
  Icon?: LucideIcon;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const go = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    go.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", key);
    // The page behind should not scroll while this is up.
    const had = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = had;
    };
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  const danger = tone === "danger";

  return (
    <div
      className="fade-in fixed inset-0 z-[100] grid place-items-center bg-[#1d1d1b]/30 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="pop-in w-full max-w-[380px] rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]">
        {Icon && (
          <span className={`mb-3 grid h-10 w-10 place-items-center rounded-full ${danger ? "bg-[#fdecec] text-[var(--red)]" : "bg-[var(--bg)] text-[var(--ink-2)]"}`}>
            <Icon size={18} />
          </span>
        )}
        <h2 className="text-[16.5px] font-semibold tracking-tight">{title}</h2>
        {message && <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--ink-2)]">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-sm" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={go}
            onClick={onConfirm}
            className={`rounded-xl px-3.5 py-1.5 text-[13px] font-medium text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              danger ? "bg-[var(--red)] hover:bg-[#d13b40] focus-visible:ring-[var(--red)]" : "bg-[#171717] hover:bg-[#2a2a2a] focus-visible:ring-[#171717]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
