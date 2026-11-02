import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { board } from "@/lib/clickup";
import { currentUser } from "@/lib/auth";
import { addDraft } from "@/lib/store";
import { taskConversation } from "@/lib/taskchat";
import { scrub } from "@/lib/teaminbox";

export const dynamic = "force-dynamic";

// The update form (/form): signed in with a login the owner created, so every update carries a real
// name. It only ever exposes project and task names — never a
// client, a phone number, an email or a chat. An update waits for the owner's approval; approving it
// posts the text as a comment on that ClickUp task.

const isDone = (s: string) => /complete|done|closed/.test(s);
const MAX_TEXT = 4000;
const PER_HOUR = 20; // updates an hour from the whole form, so a public page can't flood the inbox

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await board();
  const open = b.tasks.filter((t) => !isDone(t.status));
  // Anyone with the link sees this, and a task title can carry a client's email or number
  // ("send R1 to name@client.com"), so titles are scrubbed the same way the team inbox scrubs chats.
  return NextResponse.json({
    me: { name: me.name },
    projects: [...new Set(open.map((t) => scrub(t.project)))].sort((a, b2) => a.localeCompare(b2)),
    tasks: open.map((t) => ({ id: t.id, title: scrub(t.title), project: scrub(t.project) })).sort((a, b2) => a.title.localeCompare(b2.title)),
  });
}

// { project, taskId, text }
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const text = String(b.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Write the update first" }, { status: 400 });
  if (!b.taskId) return NextResponse.json({ error: "Pick the task" }, { status: 400 });

  const recent = Number((await get<{ n: number }>("select count(*) n from drafts where author_id = ? and created_at > ?", me.id, Date.now() - 3600_000))?.n ?? 0);
  if (recent >= PER_HOUR) return NextResponse.json({ error: `You've sent ${PER_HOUR} updates in the last hour. Please wait a bit.` }, { status: 429 });

  const task = (await board()).tasks.find((t) => t.id === String(b.taskId));
  if (!task) return NextResponse.json({ error: "That task isn't in the current projects" }, { status: 404 });

  try {
    // The task's own thread, so approving it posts the comment on that task in ClickUp
    const conv = await taskConversation(task.id, { title: task.title, project: task.project, url: task.url ?? "" });
    // The name comes from the login, not a text box, so the comment on the task is trustworthy
    await addDraft({
      conv_id: conv.id,
      project: task.project,
      author: me.name,
      author_id: me.id,
      text: `${me.name} said:\n\n${text.slice(0, MAX_TEXT)}`,
    });
    return NextResponse.json({ ok: true, task: task.title, project: task.project });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save the update" }, { status: 500 });
  }
}
