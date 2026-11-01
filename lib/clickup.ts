import { DEMO_PROJECTS, DEMO_TASKS, DEMO_TEAM, type Task } from "@/lib/demo";

// ClickUp is the source of truth. Each list is a project; folders are the project's stage
// (Current Projects, Pending From Client, Dev Completed Projects, ...). The dashboard tracks
// the Current Projects folder and creates new tasks there.
const API = "https://api.clickup.com/api/v2";
const token = () => process.env.CLICKUP_TOKEN;
export const clickupConfigured = () => !!token();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function cu<T = Any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: token()!, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.err ?? `ClickUp error ${res.status}`);
  return data as T;
}

export interface Project {
  id: string;
  name: string;
  owner: string | null; // ClickUp list status is used as the project owner's name
  stage: string; // folder name
  current: boolean;
}

export interface Board {
  source: "clickup" | "demo";
  team: string[];
  projects: string[]; // current projects (where new tasks can go)
  projectInfo: Project[]; // every project in every stage
  tasks: Task[];
  error?: string;
}

const teamId = async () => process.env.CLICKUP_TEAM_ID || String((await cu<{ teams: Any[] }>("/team")).teams[0].id);

let structureCache: { at: number; data: { projects: Project[]; currentFolderId: string | null; members: { id: number; username: string }[] } } | null = null;

async function structure() {
  if (structureCache && Date.now() - structureCache.at < 10 * 60_000) return structureCache.data;
  const team = await teamId();
  const currentName = (process.env.CLICKUP_CURRENT_FOLDER || "Current Projects").toLowerCase();
  const projects: Project[] = [];
  let currentFolderId: string | null = process.env.CLICKUP_CURRENT_FOLDER_ID || null;
  const { spaces } = await cu<{ spaces: Any[] }>(`/team/${team}/space?archived=false`);
  for (const s of spaces) {
    const { folders } = await cu<{ folders: Any[] }>(`/space/${s.id}/folder?archived=false`);
    for (const f of folders) {
      const isCurrent = currentFolderId ? String(f.id) === currentFolderId : f.name.toLowerCase() === currentName;
      if (isCurrent) currentFolderId = String(f.id);
      for (const l of f.lists) projects.push({ id: String(l.id), name: l.name.trim(), owner: l.status?.status ?? null, stage: f.name, current: isCurrent });
    }
  }
  const { teams } = await cu<{ teams: Any[] }>("/team");
  const ws = teams.find((x) => String(x.id) === team) ?? teams[0];
  const members = ws.members.map((m: Any) => ({ id: m.user.id, username: m.user.username })).filter((m: Any) => m.username);
  structureCache = { at: Date.now(), data: { projects, currentFolderId, members } };
  return structureCache.data;
}

const mapTask = (t: Any): Task => ({
  id: t.id,
  title: t.name,
  project: String(t.list?.name ?? "No project").trim(),
  assignee: t.assignees?.[0]?.username ?? "Unassigned",
  status: String(t.status?.status ?? "").toLowerCase(),
  due: t.due_date ? new Date(Number(t.due_date)).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null,
  spentMin: Math.round(Number(t.time_spent ?? 0) / 60000),
  estimateMin: t.time_estimate ? Math.round(Number(t.time_estimate) / 60000) : null,
  url: t.url,
});

async function tasksWhere(query: string, maxPages = 5) {
  const team = await teamId();
  const out: Any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const r = await cu<{ tasks: Any[]; last_page?: boolean }>(`/team/${team}/task?include_closed=true&subtasks=true&page=${page}${query}`);
    out.push(...r.tasks);
    if (r.last_page !== false || r.tasks.length < 100) break;
  }
  return out;
}

let boardCache: { at: number; data: Board } | null = null;

export async function board(force = false): Promise<Board> {
  const demo = (error?: string): Board => ({
    source: "demo",
    team: DEMO_TEAM,
    projects: DEMO_PROJECTS,
    projectInfo: DEMO_PROJECTS.map((p) => ({ id: p, name: p, owner: null, stage: "Current Projects", current: true })),
    tasks: DEMO_TASKS,
    error,
  });
  if (!token()) return demo();
  if (!force && boardCache && Date.now() - boardCache.at < 60_000) return boardCache.data;
  try {
    const s = await structure();
    const current = s.projects.filter((p) => p.current);
    // ClickUp ignores the folder filter here, so filter by the current projects' list ids instead
    const raw = current.length ? await tasksWhere(current.map((p) => `&list_ids%5B%5D=${p.id}`).join(""), 10) : [];
    const tasks = raw.map(mapTask);
    const people = new Set(tasks.map((t) => t.assignee).filter((a) => a !== "Unassigned"));
    const data: Board = {
      source: "clickup",
      team: s.members.map((m) => m.username).filter((u) => people.has(u)),
      projects: current.map((p) => p.name),
      projectInfo: s.projects,
      tasks,
    };
    boardCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return demo(e instanceof Error ? e.message : "ClickUp failed");
  }
}

export async function allMembers() {
  if (!token()) return DEMO_TEAM;
  return (await structure()).members.map((m) => m.username);
}

// Task details plus comments, where the team posts Loom links and work updates.
export async function taskDetail(id: string) {
  const [t, c] = await Promise.all([cu(`/task/${id}`), cu<{ comments: Any[] }>(`/task/${id}/comment`)]);
  const comments = (c.comments ?? []).map((x: Any) => ({ user: x.user?.username ?? "Someone", text: String(x.comment_text ?? "").trim(), at: Number(x.date) })).sort((a: Any, b: Any) => b.at - a.at);
  const attachments = (t.attachments ?? []).map((a: Any) => String(a.url ?? a.url_w_query ?? "")).filter(Boolean);
  const all = `${t.text_content ?? t.description ?? ""}\n${comments.map((x: Any) => x.text).join("\n")}\n${attachments.join("\n")}`;
  const links = [...new Set(all.match(/https?:\/\/[^\s)>\]"]+/g) ?? [])];
  return {
    ...mapTask(t),
    description: String(t.text_content ?? t.description ?? "").trim(),
    stage: t.folder?.name ?? null,
    comments,
    looms: links.filter((l) => /loom\.com/.test(l)),
    links,
  };
}

let searchCache: { at: number; tasks: Any[] } | null = null;

// Finds tasks anywhere in the workspace by words in the task or project name.
export async function searchTasks(query: string, limit = 4) {
  if (!token()) return [];
  if (!searchCache || Date.now() - searchCache.at > 5 * 60_000) searchCache = { at: Date.now(), tasks: await tasksWhere("", 10) };
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const scored = searchCache.tasks
    .map((t) => {
      const hay = `${t.name} ${t.list?.name ?? ""} ${t.folder?.name ?? ""} ${(t.assignees ?? []).map((a: Any) => a.username).join(" ")}`.toLowerCase();
      return { t, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.t.date_updated) - Number(a.t.date_updated))
    .slice(0, limit);
  return Promise.all(scored.map((x) => taskDetail(x.t.id)));
}

const PRIORITY: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

// New tasks go into the project's list inside Current Projects. A new project name creates a new list there.
export async function createTask(t: { title: string; description: string; project: string; assignee?: string; priority?: string; due?: string }) {
  if (!token()) return { ok: true, simulated: true, url: null as string | null, createdProject: false };
  const s = await structure();
  let list = s.projects.find((p) => p.current && p.name.toLowerCase() === t.project.trim().toLowerCase());
  let createdProject = false;
  if (!list) {
    if (!s.currentFolderId) throw new Error("Couldn't find the Current Projects folder in ClickUp");
    const l = await cu(`/folder/${s.currentFolderId}/list`, { method: "POST", body: JSON.stringify({ name: t.project.trim() }) });
    list = { id: String(l.id), name: l.name, owner: null, stage: "Current Projects", current: true };
    structureCache = null;
    createdProject = true;
  }
  const member = s.members.find((m) => m.username.toLowerCase() === t.assignee?.toLowerCase());
  const task = await cu(`/list/${list.id}/task`, {
    method: "POST",
    body: JSON.stringify({
      name: t.title,
      description: t.description,
      assignees: member ? [member.id] : [],
      priority: PRIORITY[t.priority ?? "normal"] ?? 3,
      due_date: t.due ? new Date(t.due).getTime() : undefined,
    }),
  });
  boardCache = null;
  searchCache = null;
  return { ok: true, simulated: false, url: task.url as string, createdProject };
}

// Where a project sits right now (e.g. "Pending From Client"), for warnings and the assistant.
export async function projectStage(name: string) {
  if (!token()) return null;
  const p = (await structure()).projects.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  return p ? { stage: p.stage, current: p.current, owner: p.owner } : null;
}
