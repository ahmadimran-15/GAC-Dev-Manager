"use client";
import { AtSign, Hash, Mail, MessageCircle, Users } from "lucide-react";

export const CHANNELS: Record<string, { label: string; color: string; Icon: typeof Mail }> = {
  whatsapp: { label: "WhatsApp", color: "#1fa855", Icon: MessageCircle },
  slack: { label: "Slack", color: "#8a3ffc", Icon: Hash },
  teams: { label: "Teams", color: "#5b5fc7", Icon: Users },
  outlook: { label: "Outlook", color: "#0f6cbd", Icon: Mail },
  email: { label: "Email", color: "#d0590f", Icon: AtSign },
};

export function Channel({ c, account, withLabel = true }: { c: string; account?: string | null; withLabel?: boolean }) {
  const ch = CHANNELS[c] ?? CHANNELS.email;
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-[var(--ink-2)]">
      <ch.Icon size={13} strokeWidth={2.2} style={{ color: ch.color }} />
      {withLabel && (
        <>
          {ch.label}
          {account ? <span className="text-[var(--muted)]"> · {account}</span> : null}
        </>
      )}
    </span>
  );
}

const PASTELS = ["#fde2e1", "#fdebd3", "#fbf3c8", "#dcf3e4", "#d9ecfb", "#e6e1fb", "#f6dff0", "#e3ecef"];

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name.replace(/[^\p{L}\s]/gu, "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "#";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[#3a3a37]"
      style={{ width: size, height: size, fontSize: size * 0.36, background: PASTELS[h % PASTELS.length] }}
    >
      {initials}
    </span>
  );
}

export const mins = (from: number, now = Date.now()) => Math.max(0, Math.round((now - from) / 60000));

export function duration(m: number) {
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d`;
}

export const ago = (t: number, now = Date.now()) => {
  const m = mins(t, now);
  return m < 1 ? "just now" : `${duration(m)} ago`;
};

// Waiting time coloured against the 15 / 30 minute marks
export function Waiting({ since, now }: { since: number; now: number }) {
  const m = mins(since, now);
  const color = m >= 30 ? "var(--red)" : m >= 15 ? "var(--amber)" : "var(--green)";
  return (
    <span className="tnum inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color }}>
      <span className="dot" style={{ background: color }} />
      {duration(m)}
    </span>
  );
}

const TONES = {
  gray: "bg-[#f1f1ee] text-[#5d5d59]",
  red: "bg-[#fdecec] text-[#c7353a]",
  amber: "bg-[#fdf3e1] text-[#9a6206]",
  green: "bg-[#e6f5ec] text-[#22794d]",
  blue: "bg-[#e8f1fc] text-[#1d63b5]",
  dark: "bg-[#171717] text-white",
};

export function Pill({ tone = "gray", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[1px] text-[11.5px] font-medium ${TONES[tone]}`}>{children}</span>;
}

export const STATUS_TONE = (s: string): keyof typeof TONES =>
  /block/.test(s)
    ? "red"
    : /revision|rework|pending|waiting|info needed|access/.test(s)
      ? "amber"
      : /progress|doing|uat|testing/.test(s)
        ? "blue"
        : /complete|done|closed/.test(s)
          ? "green"
          : "gray";

export function Section({ title, count, right, children, className = "" }: { title: string; count?: number; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13.5px] font-semibold text-[var(--ink)]">
          {title}
          {count !== undefined && <span className="tnum ml-1.5 font-normal text-[var(--muted)]">{count}</span>}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}
