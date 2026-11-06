"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, FileText, RefreshCw } from "lucide-react";
import { api } from "@/components/Live";

// Everything you approved today, as one block of text to pass upwards: grouped by person, then by
// project, then the updates themselves. Built from the approved updates, so it is what actually went
// onto the tasks — not a summary of it.

interface Handled {
  id: string;
  author: string;
  text: string;
  project: string | null;
  status: string;
  created_at: number;
  conv_name: string | null;
}

const midnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// The stored text opens with "Update of Task\n<name> · <task>\n\n…" — that header is for the task
// thread, not for this, so it comes off here.
function bodyOf(text: string) {
  const t = String(text ?? "").trim();
  const m = t.match(/^Update of Task\n[^\n]*\n+([\s\S]*)$/);
  return (m ? m[1] : t).trim();
}

export default function DailyDigest() {
  const [rows, setRows] = useState<Handled[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    api<{ drafts: Handled[] }>(`/api/drafts?since=${midnight()}`)
      .then((r) => setRows((r.drafts ?? []).filter((d) => d.status === "approved")))
      .catch(() => setRows([]))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
  }, []);

  // person → project → updates
  const grouped = useMemo(() => {
    const people = new Map<string, Map<string, Handled[]>>();
    for (const d of [...(rows ?? [])].sort((a, b) => a.created_at - b.created_at)) {
      const byProject = people.get(d.author) ?? new Map<string, Handled[]>();
      const key = d.project || "Other";
      byProject.set(key, [...(byProject.get(key) ?? []), d]);
      people.set(d.author, byProject);
    }
    return people;
  }, [rows]);

  const text = useMemo(() => {
    const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    if (!grouped.size) return `Updates — ${day}\n\nNothing approved today.`;
    const out: string[] = [`Updates — ${day}`, ""];
    for (const [person, projects] of grouped) {
      out.push(`${person}`);
      for (const [project, items] of projects) {
        out.push(`  ${project}`);
        for (const d of items) {
          const task = d.conv_name ? `${d.conv_name}: ` : "";
          out.push(`    - ${task}${bodyOf(d.text).replace(/\s*\n+\s*/g, " ")}`);
        }
      }
      out.push("");
    }
    return out.join("\n").trim();
  }, [grouped]);

  const count = rows?.length ?? 0;

  return (
    <div className="card px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <FileText size={15} className="text-[var(--ink-2)]" />
        <span className="text-[13.5px] font-medium">Approved today</span>
        <span className="tnum text-[12.5px] text-[var(--muted)]">
          {rows === null ? "loading…" : `${count} update${count === 1 ? "" : "s"} · ${grouped.size} ${grouped.size === 1 ? "person" : "people"}`}
        </span>
        <button className="btn btn-ghost btn-sm ml-auto !px-2" title="Refresh" onClick={load} disabled={busy}>
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        </button>
        <button
          className="btn btn-sm"
          disabled={!count}
          onClick={async () => {
            await navigator.clipboard.writeText(text).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy for your manager"}
        </button>
      </div>

      {!!count && <pre className="scroll mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--bg)] p-3 font-sans text-[13px] leading-relaxed">{text}</pre>}
      {rows !== null && !count && <p className="mt-2 text-[13px] text-[var(--muted)]">Nothing approved today yet.</p>}
    </div>
  );
}
