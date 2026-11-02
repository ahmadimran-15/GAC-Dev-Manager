import { DEMO_PROJECTS, DEMO_TASKS, DEMO_TEAM, type Task } from "@/lib/demo";
import { kvGet, kvSet } from "@/lib/db";

// ClickUp is the source of truth. Each list is a project; folders are the project's stage
// (Current Projects, Pending From Client, Dev Completed Projects, ...). The dashboard tracks
// the Current Projects folder and creates new tasks there.
const API = "https://api.clickup.com/api/v2";
const token = () => process.env.CLICKUP_TOKEN;
export const clickupConfigured = () => !!token();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// ClickUp allows 100 requests a minute per token. We stay under that ourselves, so a busy moment
// (a board refresh while the assistant searches) never returns "Rate limit reached" to the dashboard.
const LIMIT_PER_MIN = Number(process.env.CLICKUP_RATE_LIMIT ?? 85);
const calls: number[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function slot() {
  for (;;) {
    const cutoff = Date.now() - 60_000;
    while (calls.length && calls[0] < cutoff) calls.shift();
    if (calls.length < LIMIT_PER_MIN) {
      calls.push(Date.now());
      return;
    }
    await wait(Math.max(250, calls[0] + 60_000 - Date.now()));
  }
}

async function cu<T = Any>(path: string, init?: RequestInit, retry = true, version: "v2" | "v3" = "v2"): Promise<T> {
  await slot();
  const res = await fetch(`${version === "v3" ? API.replace("/v2", "/v3") : API}${path}`, {
    ...init,
    headers: { Authorization: token()!, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (res.status === 429 && retry) {
    // Something else is using the same token: wait the time ClickUp asks for, then try once more
    await wait(Math.min(60_000, (Number(res.headers.get("retry-after")) || 20) * 1000));
    return cu<T>(path, init, false, version);
  }
  // Always say which service failed, so "Rate limit reached" can't look like Gemini or WhatsApp
  if (!res.ok) throw new Error(`ClickUp: ${data?.err ?? `error ${res.status}`}`);
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

let structureCache: { at: number; data: { projects: Project[]; currentFolderId: string | null; folders: { id: string; name: string; lists: number; current: boolean }[]; members: { id: number; username: string }[] } } | null = null;

// Which folders and single projects count as "current" in GAC Desk, on top of the Current Projects folder.
// ClickUp's API can't move a list into another folder, so a project is brought up by marking it here.
// Folders start as current by default: Loom Videos sits under Current Projects in the way the team works.
const DEFAULT_FOLDERS = ["loom videos"];
type Marks = { folders: string[]; lists: string[]; off: string[] };
const marks = async (): Promise<Marks> => ({ folders: [], lists: [], off: [], ...JSON.parse((await kvGet("current_marks")) ?? "{}") });

export async function markCurrent(kind: "folder" | "project", id: string, on: boolean) {
  const m = await marks();
  const key = kind === "folder" ? "folders" : "lists";
  m[key] = m[key].filter((x) => x !== id);
  m.off = m.off.filter((x) => x !== id);
  if (on) m[key].push(id);
  else m.off.push(id); // off also switches off a default (Loom Videos) or the Current Projects folder itself
  await kvSet("current_marks", JSON.stringify(m));
  structureCache = null;
  invalidateBoard();
  return m;
}

async function structure() {
  if (structureCache && Date.now() - structureCache.at < 10 * 60_000) return structureCache.data;
  const team = await teamId();
  const currentName = (process.env.CLICKUP_CURRENT_FOLDER || "Current Projects").toLowerCase();
  const m = await marks();
  const projects: Project[] = [];
  const folders: { id: string; name: string; lists: number; current: boolean }[] = [];
  let currentFolderId: string | null = process.env.CLICKUP_CURRENT_FOLDER_ID || null;
  const { spaces } = await cu<{ spaces: Any[] }>(`/team/${team}/space?archived=false`);
  for (const s of spaces) {
    const { folders: fs } = await cu<{ folders: Any[] }>(`/space/${s.id}/folder?archived=false`);
    for (const f of fs) {
      const id = String(f.id);
      const isMain = currentFolderId ? id === currentFolderId : f.name.toLowerCase() === currentName;
      if (isMain) currentFolderId = id;
      const isCurrent = !m.off.includes(id) && (isMain || m.folders.includes(id) || DEFAULT_FOLDERS.includes(f.name.toLowerCase()));
      folders.push({ id, name: f.name, lists: f.lists.length, current: isCurrent });
      for (const l of f.lists)
        projects.push({
          id: String(l.id),
          name: l.name.trim(),
          owner: l.status?.status ?? null,
          stage: f.name,
          current: !m.off.includes(String(l.id)) && (isCurrent || m.lists.includes(String(l.id))),
        });
    }
  }
  const { teams } = await cu<{ teams: Any[] }>("/team");
  const ws = teams.find((x) => String(x.id) === team) ?? teams[0];
  const members = ws.members.map((m: Any) => ({ id: m.user.id, username: m.user.username })).filter((m: Any) => m.username);
  structureCache = { at: Date.now(), data: { projects, currentFolderId, folders, members } };
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
  priority: (["urgent", "high", "normal", "low"].includes(String(t.priority?.priority)) ? t.priority.priority : null) as Task["priority"],
  dueAt: t.due_date ? Number(t.due_date) : null,
  doneAt: t.date_done ? Number(t.date_done) : t.date_closed ? Number(t.date_closed) : null,
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

// Every project name in every folder (Current Projects, Loom Videos, Pending From Client, ...).
// force re-reads the folders from ClickUp, so new or renamed projects show up straight away.
export async function allProjects(force = false): Promise<Project[]> {
  if (!token()) return DEMO_PROJECTS.map((p) => ({ id: p, name: p, owner: null, stage: "Current Projects", current: true }));
  if (force) {
    structureCache = null;
    invalidateBoard(); // a project added or renamed in ClickUp also changes the task board
  }
  return (await structure()).projects;
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
  if (!token()) return { ok: true, simulated: true, url: null as string | null, id: null as string | null, createdProject: false };
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
  return { ok: true, simulated: false, url: task.url as string, id: String(task.id), createdProject };
}

export function invalidateBoard() {
  boardCache = null;
  searchCache = null;
}

// ---------- Two-way status sync ----------

// The statuses a task can move to (they come from its list), plus its current one.
export async function taskStatuses(taskId: string) {
  const t = await cu(`/task/${taskId}`);
  const list = await cu(`/list/${t.list.id}`);
  return {
    current: String(t.status?.status ?? "").toLowerCase(),
    title: t.name as string,
    assignee: (t.assignees?.[0]?.username as string) ?? "Unassigned",
    options: (list.statuses ?? []).map((s: Any) => ({ status: String(s.status).toLowerCase(), color: s.color as string, type: s.type as string })) as { status: string; color: string; type: string }[],
  };
}

export async function setTaskStatus(taskId: string, status: string) {
  await cu(`/task/${taskId}`, { method: "PUT", body: JSON.stringify({ status }) });
  invalidateBoard();
}

// When a timer starts on a task that hasn't been started yet, move it to the list's "in progress" status.
export async function markInProgress(taskId: string) {
  const s = await taskStatuses(taskId);
  const cur = s.options.find((o) => o.status === s.current);
  if (cur && cur.type !== "open") return null;
  const target = s.options.find((o) => /progress|doing|working/.test(o.status));
  if (!target) return null;
  await setTaskStatus(taskId, target.status);
  return { from: s.current, to: target.status, title: s.title, assignee: s.assignee };
}

// A task's comments, oldest first, with the author and ClickUp's own comment id.
export async function taskComments(taskId: string) {
  const c = await cu<{ comments: Any[] }>(`/task/${taskId}/comment`);
  return (c.comments ?? [])
    .map((x: Any) => ({
      id: String(x.id),
      user: (x.user?.username as string) ?? "Someone",
      userId: Number(x.user?.id ?? 0),
      text: String(x.comment_text ?? "").trim(),
      at: Number(x.date),
    }))
    .filter((x) => x.text)
    .sort((a, b) => a.at - b.at);
}

// Enough about a task to open a conversation for it
export async function taskBrief(taskId: string) {
  const t = await cu(`/task/${taskId}`);
  return { id: String(t.id), title: t.name as string, project: String(t.list?.name ?? "No project").trim(), url: t.url as string, assignee: (t.assignees?.[0]?.username as string) ?? "Unassigned" };
}

// A comment on the task. notify=false: nobody gets a ClickUp notification for it.
export async function postComment(taskId: string, text: string, notify = false) {
  return cu<{ id: string }>(`/task/${taskId}/comment`, { method: "POST", body: JSON.stringify({ comment_text: text, notify_all: notify }) });
}

let meCache: { id: number; username: string } | null = null;
export async function clickupMe() {
  meCache ??= (await cu<{ user: Any }>("/user")).user;
  return meCache!;
}

// ClickUp's API can only log time for the token's owner on the Free plan; others stay in our own log.
export async function pushTimeEntry(taskId: string, startMs: number, durationMs: number, note = "GAC Desk timer") {
  const team = await teamId();
  await cu(`/team/${team}/time_entries`, { method: "POST", body: JSON.stringify({ tid: taskId, start: startMs, duration: durationMs, description: note }) });
}

// Registers (or re-points) our webhook so status changes made in ClickUp reach the dashboard instantly.
export async function registerClickupWebhook(endpoint: string) {
  const team = await teamId();
  const events = ["taskStatusUpdated", "taskCreated", "taskUpdated", "taskDeleted", "taskAssigneeUpdated", "taskCommentPosted", "taskTimeTrackedUpdated"];
  const { webhooks } = await cu<{ webhooks: Any[] }>(`/team/${team}/webhook`);
  const mine = webhooks.find((w) => String(w.endpoint).includes("/api/webhooks/clickup"));
  if (mine) {
    const r = await cu(`/webhook/${mine.id}`, { method: "PUT", body: JSON.stringify({ endpoint, events, status: "active" }) });
    return { id: String(mine.id), secret: String(r?.webhook?.secret ?? mine.secret ?? "") };
  }
  const r = await cu(`/team/${team}/webhook`, { method: "POST", body: JSON.stringify({ endpoint, events }) });
  return { id: String(r.id), secret: String(r.webhook?.secret ?? "") };
}

// Registers our webhook at PUBLIC_URL and remembers its secret. Skips the call when nothing changed
// (unless forced). The owner's n8n webhooks are never touched: only ours (/api/webhooks/clickup) is matched.
export async function ensureClickupWebhook(force = false) {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (!token()) throw new Error("CLICKUP_TOKEN is not set");
  if (!base) throw new Error("PUBLIC_URL is not set");
  const endpoint = `${base}/api/webhooks/clickup`;
  const saved = JSON.parse((await kvGet("clickup_webhook")) ?? "null") as { id: string; secret: string; endpoint: string } | null;
  if (!force && saved?.endpoint === endpoint && saved.secret) return { ...saved, changed: false };
  const r = await registerClickupWebhook(endpoint);
  // Keep the old secret if ClickUp didn't send one back on an update
  const hook = { id: r.id, secret: r.secret || (saved?.id === r.id ? saved.secret : ""), endpoint, at: Date.now() };
  await kvSet("clickup_webhook", JSON.stringify(hook));
  return { ...hook, changed: true };
}

export async function clickupWebhookInfo() {
  const saved = JSON.parse((await kvGet("clickup_webhook")) ?? "null") as { id: string; endpoint: string; at?: number } | null;
  const last = await kvGet("clickup_last_event");
  return { registered: saved ? { id: saved.id, endpoint: saved.endpoint, at: saved.at ?? null } : null, lastEvent: last ? Number(last) : null };
}

// ---------- Moving a whole project to another folder ----------
// ClickUp's API can't move a list between folders, so we do what a person would do by hand: make the
// list in the target folder, move every task into it, then remove the empty original. Statuses that
// don't exist in the target folder are mapped and reported, never silently dropped.

export async function planProjectMove(project: string, folder: string) {
  const s = await structure();
  const want = project.trim().toLowerCase();
  const list = s.projects.find((p) => p.name.toLowerCase() === want) ?? s.projects.find((p) => p.name.toLowerCase().includes(want));
  if (!list) throw new Error(`No project called "${project}"`);
  const target = [...new Set(s.projects.map((p) => p.stage))].find((f) => f.toLowerCase() === folder.trim().toLowerCase()) ?? [...new Set(s.projects.map((p) => p.stage))].find((f) => f.toLowerCase().includes(folder.trim().toLowerCase()));
  if (!target) throw new Error(`No folder called "${folder}"`);
  if (list.stage === target) throw new Error(`"${list.name}" is already in ${target}`);
  const tasks = await cu<{ tasks: Any[] }>(`/list/${list.id}/task?include_closed=true&subtasks=true`);
  return { listId: list.id, name: list.name, from: list.stage, to: target, tasks: (tasks.tasks ?? []).length };
}

export async function moveProjectToFolder(project: string, folder: string) {
  const plan = await planProjectMove(project, folder);
  const s = await structure();
  const folderId = s.folders.find((f) => f.name === plan.to)?.id;
  if (!folderId) throw new Error(`Couldn't find the ${plan.to} folder`);
  const team = await teamId();

  const created = await cu<Any>(`/folder/${folderId}/list`, { method: "POST", body: JSON.stringify({ name: plan.name }) });
  const newId = String(created.id);
  // Statuses the new list doesn't have get mapped onto its first matching (or first open) status
  const from = await cu<Any>(`/list/${plan.listId}`);
  const to = await cu<Any>(`/list/${newId}`);
  const toStatuses = (to.statuses ?? []) as Any[];
  const fallback = toStatuses.find((x: Any) => x.type === "open") ?? toStatuses[0];
  const mappings = ((from.statuses ?? []) as Any[])
    .filter((f: Any) => !toStatuses.some((t: Any) => String(t.status).toLowerCase() === String(f.status).toLowerCase()))
    .map((f: Any) => ({ source_status_id: f.id, destination_status_id: fallback?.id, from: String(f.status), to: String(fallback?.status ?? "") }))
    .filter((m) => m.destination_status_id);

  const { tasks } = await cu<{ tasks: Any[] }>(`/list/${plan.listId}/task?include_closed=true&subtasks=true`);
  let moved = 0;
  const failed: string[] = [];
  for (const t of tasks ?? []) {
    try {
      await cu(`/workspaces/${team}/tasks/${t.id}/home_list/${newId}`, {
        method: "PUT",
        body: JSON.stringify({ move_custom_fields: true, status_mappings: mappings.map(({ source_status_id, destination_status_id }) => ({ source_status_id, destination_status_id })) }),
      }, true, "v3");
      moved++;
    } catch (e) {
      failed.push(`${t.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  // Only remove the original once everything has left it
  let removed = false;
  if (moved === (tasks ?? []).length && !failed.length) {
    await cu(`/list/${plan.listId}`, { method: "DELETE" }).then(() => (removed = true)).catch(() => {});
  }
  structureCache = null;
  invalidateBoard();
  return { ...plan, moved, failed, removed, remapped: mappings.map((m) => `${m.from} → ${m.to}`) };
}

// Where a project sits right now (e.g. "Pending From Client"), for warnings and the assistant.
export async function projectStage(name: string) {
  if (!token()) return null;
  const p = (await structure()).projects.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  return p ? { stage: p.stage, current: p.current, owner: p.owner } : null;
}

// Every folder in the workspace with its "counts as a current project" flag, for Settings.
export async function projectFolders(force = false) {
  if (!token()) return [];
  if (force) structureCache = null;
  return (await structure()).folders;
}
