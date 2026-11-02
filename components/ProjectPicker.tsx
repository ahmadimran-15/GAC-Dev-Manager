"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RotateCw, Search } from "lucide-react";
import { api } from "@/components/Live";

export interface ProjectName {
  name: string;
  stage: string; // ClickUp folder
  current: boolean;
}

// Folders shown first, in this order; any other folder follows in ClickUp's order
const FIRST = ["current projects", "loom videos"];
const rank = (stage: string) => {
  const i = FIRST.indexOf(stage.toLowerCase());
  return i < 0 ? FIRST.length : i;
};

// Every project name from every ClickUp folder (Current Projects, Loom Videos, ...), with search,
// a refresh to pull the latest names, and "use as new project" when nothing matches.
export default function ProjectPicker({ value, onChange, fallback }: { value: string; onChange: (v: string) => void; fallback: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<ProjectName[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  async function load(refresh = false) {
    setLoading(true);
    setError("");
    try {
      setList((await api<{ projects: ProjectName[] }>(`/api/clickup/projects${refresh ? "?refresh=1" : ""}`)).projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ClickUp failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const all = list ?? fallback.map((name) => ({ name, stage: "Current Projects", current: true }));
  const shown = all.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [...new Set(shown.map((p) => p.stage))].sort((a, b) => rank(a) - rank(b));
  const exact = all.some((p) => p.name.toLowerCase() === q.trim().toLowerCase());
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`input flex items-center gap-2 text-left ${open ? "!border-[#a8a8a2]" : ""}`}>
        <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-[var(--muted)]"}`}>{value || "Pick a project"}</span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--ink-2)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="fade-in absolute left-0 top-[calc(100%+4px)] z-[70] w-[min(340px,calc(100vw/var(--ui-zoom)-48px))] overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.22)]">
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
            <Search size={13} className="shrink-0 text-[var(--muted)]" />
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted)]"
              placeholder={`Search ${all.length} projects`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && q.trim() && pick(shown.find((p) => p.name.toLowerCase() === q.trim().toLowerCase())?.name ?? shown[0]?.name ?? q.trim())}
            />
            <button type="button" className="btn btn-ghost !h-7 !w-7 shrink-0 !p-0" title="Get the latest project names from ClickUp" disabled={loading} onClick={() => load(true)}>
              <RotateCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="scroll max-h-[300px] p-1">
            {error && <div className="px-2.5 py-2 text-[12.5px] text-[var(--red)]">{error}</div>}
            {groups.map((g) => (
              <div key={g}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{g}</div>
                {shown
                  .filter((p) => p.stage === g)
                  .map((p) => (
                    <button
                      key={`${g}-${p.name}`}
                      type="button"
                      onClick={() => pick(p.name)}
                      className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] ${p.name === value ? "bg-[var(--bg)] font-medium" : "hover:bg-[var(--bg)]"}`}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            ))}
            {q.trim() && !exact && (
              <button type="button" onClick={() => pick(q.trim())} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--bg)]">
                <Plus size={13} className="shrink-0 text-[var(--muted)]" />
                <span className="truncate">New project “{q.trim()}”</span>
              </button>
            )}
            {!shown.length && !q.trim() && !loading && <div className="px-2.5 py-2 text-[12.5px] text-[var(--muted)]">No projects found</div>}
          </div>
        </div>
      )}
    </div>
  );
}
