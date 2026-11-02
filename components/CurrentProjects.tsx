"use client";
import { useCallback, useEffect, useState } from "react";
import { RotateCw, Search } from "lucide-react";
import { api, useLive } from "@/components/Live";

interface Folder {
  id: string;
  name: string;
  lists: number;
  current: boolean;
  tasks: number;
}
interface Project {
  id: string;
  name: string;
  stage: string;
  current: boolean;
}

// Which ClickUp folders count as current projects, and single projects brought up from another folder.
// ClickUp's API can't move a list between folders, so the project stays where it is in ClickUp and
// GAC Desk treats it as current: its tasks show on the Team page and new tasks can go into it.
export default function CurrentProjects() {
  const { toast } = useLive();
  const [data, setData] = useState<{ folders: Folder[]; projects: Project[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setData(await api<{ folders: Folder[]; projects: Project[] }>(`/api/clickup/folders${refresh ? "?refresh=1" : ""}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : "ClickUp failed", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function mark(kind: "folder" | "project", id: string, on: boolean) {
    setBusy(id);
    try {
      await api("/api/clickup/folders", { kind, id, on });
      await load(true);
      toast(on ? "Added to current projects" : "Removed from current projects");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy("");
    }
  }

  const folders = data?.folders ?? [];
  // Projects sitting in a folder that isn't current: searchable, so one can be brought up on its own
  const loose = (data?.projects ?? []).filter((p) => !folders.find((f) => f.name === p.stage)?.current);
  const hits = q.trim() ? loose.filter((p) => `${p.name} ${p.stage}`.toLowerCase().includes(q.trim().toLowerCase())) : loose.filter((p) => p.current);

  return (
    <div className="card divide-y divide-[var(--line)] px-5">
      <div className="flex items-center justify-between gap-3 py-4">
        <p className="text-[13px] text-[var(--ink-2)]">
          Tasks from these folders show on the Team page, and new tasks can go into their projects.
        </p>
        <button className="btn btn-sm shrink-0" onClick={() => load(true)} disabled={loading}>
          <RotateCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      {folders.map((f) => (
        <label key={f.id} className="flex cursor-pointer items-center gap-3 py-3 text-[14px]">
          <input type="checkbox" className="h-4 w-4 accent-[#171717]" checked={f.current} disabled={busy === f.id} onChange={(e) => mark("folder", f.id, e.target.checked)} />
          <span className="flex-1 font-medium">{f.name}</span>
          <span className="tnum text-[12.5px] text-[var(--muted)]">{f.lists} projects</span>
        </label>
      ))}
      <div className="py-4">
        <div className="mb-2 text-[13px] font-medium">Bring one project up</div>
        <p className="mb-2 text-[12.5px] text-[var(--muted)]">
          A single project from Pending From Client or any other folder. ClickUp keeps it in its own folder; GAC Desk treats it as current.
        </p>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input className="input !pl-9" placeholder="Search every project…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="mt-2 max-h-[280px] space-y-1 overflow-y-auto">
          {hits.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-[var(--bg)]">
              <input type="checkbox" className="h-4 w-4 accent-[#171717]" checked={p.current} disabled={busy === p.id} onChange={(e) => mark("project", p.id, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="shrink-0 text-[12px] text-[var(--muted)]">{p.stage}</span>
            </label>
          ))}
          {!hits.length && <p className="px-2 py-3 text-[13px] text-[var(--muted)]">{q ? "No project with that name" : "None brought up yet. Search to add one."}</p>}
        </div>
      </div>
    </div>
  );
}
