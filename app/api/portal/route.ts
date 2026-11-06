import { NextResponse } from "next/server";
import { all, get } from "@/lib/db";
import { currentUser, requireTeam } from "@/lib/auth";
import { mayOpen } from "@/lib/session";
import { addDraft } from "@/lib/store";
import { board } from "@/lib/clickup";
import { getUser, updateUser } from "@/lib/users";
import { minutesByTask, runningTimers, startTimer, stopTask, stopTimer, timersEnabled } from "@/lib/timers";

export const dynamic = "force-dynamic";

const isDone = (s: string) => /complete|done|closed/.test(s);
const RATE_LIMIT = 30; // client updates per hour per person

// Team portal: current projects, client first names (never numbers or emails), your own submissions,
// and your ClickUp tasks with a start/stop timer (stamped by the server clock).
export async function GET() {
  const { deny: noAccess } = await requireTeam("portal");
  if (noAccess) return noAccess;
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [b, clients, mine, user, running, tracked, timersOn] = await Promise.all([
    board(),
    all<{ id: string; name: string; project: string | null; channel: string }>("select id, name, project, channel from conversations where demo = 0 order by name"),
    all<{ id: string; text: string; project: string | null; status: string; created_at: number; conv_name: string | null }>(
      "select d.id, d.text, d.project, d.status, d.created_at, c.name conv_name from drafts d left join conversations c on c.id = d.conv_id where d.author_id = ? order by d.created_at desc limit 30",
      me.id,
    ),
    getUser(me.id),
    runningTimers(),
    minutesByTask(),
    timersEnabled(),
  ]);
  const cu = user?.clickupName ?? null;
  const tasks = cu
    ? b.tasks
        .filter((t) => t.assignee === cu && !isDone(t.status))
        .map((t) => ({ id: t.id, title: t.title, project: t.project, status: t.status, due: t.due, estimateMin: t.estimateMin, trackedMin: tracked[t.id] ?? 0, url: t.url }))
    : [];
  return NextResponse.json({
    now: Date.now(),
    me: { name: me.name, email: me.email, clickupName: cu },
    // What else this login may open, so the bar can show only the buttons that work for them
    can: { form: mayOpen(me, "form"), portal: mayOpen(me, "portal") },
    projects: b.projects,
    // First names only; a chat saved under a phone number or email never shows it
    clients: clients
      .map((c) => ({ id: c.id, label: /^\+?[\d\s()-]{6,}$/.test(c.name) || c.name.includes("@") ? `${c.channel === "email" ? "Email" : "WhatsApp"} client` : c.name.split(" ")[0], project: c.project })),
    mine: mine.map((d) => ({ ...d, created_at: Number(d.created_at), conv_name: d.conv_name ? (/^\+?[\d\s()-]{6,}$/.test(d.conv_name) || d.conv_name.includes("@") ? "client" : d.conv_name.split(" ")[0]) : null })),
    tasks,
    running: cu ? (running.find((r) => r.person === cu) ?? null) : null,
    timersOn,
  });
}

export async function POST(req: Request) {
  const { deny: noAccess } = await requireTeam("portal");
  if (noAccess) return noAccess;
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.action === "password") {
    try {
      await updateUser(me.id, { password: String(b.password ?? "") });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
    }
  }

  // Timers: only on your own ClickUp tasks
  if (b.action === "start" || b.action === "stop") {
    const cu = (await getUser(me.id))?.clickupName;
    if (!cu) return NextResponse.json({ error: "Your login isn't linked to a ClickUp name yet. Ask your manager." }, { status: 400 });
    if (b.action === "stop") {
      const r = (await runningTimers()).find((t) => t.person === cu);
      if (!r) return NextResponse.json({ error: "No timer is running" }, { status: 404 });
      const timer = await stopTimer(r.id);
      await stopTask(r.task_id);
      return NextResponse.json({ ok: true, timer });
    }
    const t = (await board()).tasks.find((x) => x.id === b.taskId);
    if (!t || t.assignee !== cu) return NextResponse.json({ error: "That task isn't assigned to you" }, { status: 403 });
    try {
      return NextResponse.json({ ok: true, id: await startTimer({ taskId: t.id, taskTitle: t.title, project: t.project, person: cu, by: me.name }) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
    }
  }

  const text = String(b.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Write the update first" }, { status: 400 });
  if (!b.project && !b.conv_id) return NextResponse.json({ error: "Pick the project" }, { status: 400 });
  const recent = Number((await get<{ n: number }>("select count(*) n from drafts where author_id = ? and created_at > ?", me.id, Date.now() - 3600_000))?.n ?? 0);
  if (recent >= RATE_LIMIT) return NextResponse.json({ error: `You've sent ${RATE_LIMIT} updates in the last hour. Please wait a bit.` }, { status: 429 });
  await addDraft({ conv_id: b.conv_id || null, project: b.project || null, author: me.name, author_id: me.id, text: text.slice(0, 4000) });
  return NextResponse.json({ ok: true });
}
