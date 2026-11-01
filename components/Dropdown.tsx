"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  hint?: string;
}

// A labelled dropdown in the app's own style ("Project  Ladeena ▾"), instead of the browser's native list.
// Long lists get a search box. Closes on outside click or Escape.
export default function Dropdown({
  label,
  value,
  options,
  onChange,
  title,
  align = "left",
  bare = false,
  up = false,
}: {
  label?: string;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  title?: string;
  align?: "left" | "right";
  bare?: boolean; // no border (for compact toolbars)
  up?: boolean; // open above (for controls near the bottom of the screen)
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const searchable = options.length > 8;
  const shown = q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase())) : options;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-8 max-w-[320px] items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition ${
          bare ? "hover:bg-[var(--hover)]" : `border bg-white ${open ? "border-[#a8a8a2]" : "border-[var(--line-2)] hover:border-[#a8a8a2]"}`
        }`}
      >
        {label && <span className="shrink-0 text-[var(--muted)]">{label}</span>}
        <span className="truncate font-medium text-[var(--ink)]">{current?.label ?? "—"}</span>
        <ChevronDown size={13} className={`shrink-0 text-[var(--ink-2)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`fade-in absolute ${up ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"} z-[70] w-max min-w-full max-w-[340px] overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.22)] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
              <Search size={13} className="text-[var(--muted)]" />
              <input autoFocus className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--muted)]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="scroll max-h-[280px] p-1">
            {shown.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${on ? "bg-[var(--bg)] font-medium" : "hover:bg-[var(--bg)]"}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {o.label}
                    {o.hint && <span className="font-normal text-[var(--muted)]"> · {o.hint}</span>}
                  </span>
                  <Check size={13} className={on ? "shrink-0 text-[var(--ink)]" : "invisible shrink-0"} />
                </button>
              );
            })}
            {!shown.length && <div className="px-2.5 py-2 text-[12.5px] text-[var(--muted)]">Nothing found</div>}
          </div>
        </div>
      )}
    </div>
  );
}
