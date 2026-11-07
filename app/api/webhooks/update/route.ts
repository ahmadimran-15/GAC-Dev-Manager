import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { board, taskStatuses } from "@/lib/clickup";
import { addDraft } from "@/lib/store";
import { taskConversation } from "@/lib/taskchat";
import { checkUpdateToken } from "@/lib/updatetokens";
import { listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

// Another app posting a team update into the approval queue — the same place the update form inside
// GAC Desk puts them. Nothing reaches a client or a ClickUp task until it is approved here.
//
// Authenticated by a token, not a session: the other codebase has no way to sign a person in. The
// token says which app is posting; the body says who wrote it, and that name has to belong to
// somebody on the team, so a leaked token still cannot file an update as a stranger.
//
//   POST /api/webhooks/update
//   Authorization: Bearer gacu_…
//   { "person": "Anas Fazal", "task": "<clickup task id>", "text": "...", "status": "in progress" }

const MAX_TEXT = 4000;
const PER_HOUR = 20;

const isDone = (s: string) => /complete|done|closed/.test(s);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function POST(req: Request) {
  const app = await checkUpdateToken(req.headers.get("authorization") ?? req.headers.get("x-gac-token"));
  if (!app) return NextResponse.json({ error: "Unknown or missing token" }, { status: 401 });

  const b = await req.json().catch(() => ({}) as Record<string, unknown>);
  const person = String(b.person ?? "").trim();
  const text = String(b.text ?? "").trim();
  if (!person) return NextResponse.json({ error: "Who wrote it? Send 'person'." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Send the update in 'text'." }, { status: 400 });

  // The name has to be someone on the team: a GAC Desk login or a ClickUp member. This is what keeps
  // the endpoint to the development team rather than anyone who gets hold of the token.
  const [users, b0] = await Promise.all([listUsers().catch(() => []), board()]);
  const people = new Set<string>();
  for (const u of users) {
    people.add(norm(u.name));
    if (u.clickupName) people.add(norm(u.clickupName));
  }
  for (const t of b0.tasks) if (t.assignee) people.add(norm(t.assignee));
  if (!people.has(norm(person)))
    return NextResponse.json({ error: `"${person}" is not on the team. Use the name as it appears in ClickUp or in Users → Logins.`, known: [...people].sort() }, { status: 403 });

  // Too many from one person in an hour is a loop in the other app, not a busy day.
  const recent = Number((await get<{ n: number }>("select count(*) n from drafts where author = ? and created_at > ?", person, Date.now() - 3600_000))?.n ?? 0);
  if (recent >= PER_HOUR) return NextResponse.json({ error: `${person} has filed ${PER_HOUR} updates in the last hour. Slow down.` }, { status: 429 });

  // Which task: its ClickUp id, or its title (with the project when two tasks share a name).
  const open = b0.tasks.filter((t) => !isDone(t.status));
  const wantTask = String(b.task ?? b.taskId ?? "").trim();
  const wantTitle = norm(String(b.taskTitle ?? b.title ?? ""));
  const wantProject = norm(String(b.project ?? ""));
  const task =
    (wantTask && open.find((t) => t.id === wantTask)) ||
    (wantTitle && open.find((t) => norm(t.title) === wantTitle && (!wantProject || norm(t.project) === wantProject))) ||
    (wantTitle && open.find((t) => norm(t.title).includes(wantTitle) && (!wantProject || norm(t.project) === wantProject)));
  if (!task)
    return NextResponse.json(
      { error: "That task isn't in the current projects. Send 'task' with the ClickUp task id, or 'taskTitle' (and 'project' if the name repeats)." },
      { status: 404 },
    );

  // An asked-for status is checked against that task's own list, so a typo is reported here rather
  // than silently ignored when the update is approved.
  const wantStatus = String(b.status ?? "").trim().toLowerCase();
  if (wantStatus) {
    const s = await taskStatuses(task.id).catch(() => null);
    if (s && !s.options.some((o) => o.status === wantStatus))
      return NextResponse.json({ error: `"${wantStatus}" isn't a status on that task.`, statuses: s.options.map((o) => o.status) }, { status: 400 });
  }

  const conv = await taskConversation(task.id, { title: task.title, project: task.project, url: task.url ?? "" });
  const id = await addDraft({
    conv_id: conv.id,
    project: task.project,
    author: person,
    text: `Update of Task\n${person} · ${task.title}\n\n${text.slice(0, MAX_TEXT)}`,
    taskStatus: wantStatus || null,
  });

  return NextResponse.json({ ok: true, draft: id, task: task.title, project: task.project, status: wantStatus || null, via: app.name });
}

// So the other app can check the token and show the right task list.
export async function GET(req: Request) {
  const app = await checkUpdateToken(req.headers.get("authorization") ?? req.headers.get("x-gac-token"));
  if (!app) return NextResponse.json({ error: "Unknown or missing token" }, { status: 401 });
  const b0 = await board();
  const open = b0.tasks.filter((t) => !isDone(t.status));
  return NextResponse.json({
    ok: true,
    app: app.name,
    projects: [...new Set(open.map((t) => t.project))].sort(),
    tasks: open.map((t) => ({ id: t.id, title: t.title, project: t.project, status: t.status, assignee: t.assignee ?? null })),
  });
}
