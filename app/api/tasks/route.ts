import { NextResponse } from "next/server";
import { createTask } from "@/lib/clickup";
import { run } from "@/lib/db";

// Creates the task in ClickUp; when it came from a conversation, remembers which messages it covers.
export async function POST(req: Request) {
  const t = await req.json().catch(() => ({}));
  if (!String(t.title ?? "").trim() || !String(t.project ?? "").trim()) return NextResponse.json({ error: "Title and project are required" }, { status: 400 });
  try {
    const r = await createTask({ title: t.title, description: t.description ?? "", project: t.project, assignee: t.assignee, priority: t.priority, due: t.due });
    if (r.id && t.conv_id) {
      const ids = Array.isArray(t.message_ids) ? t.message_ids.map(String).slice(0, 200) : [];
      await run(
        "insert into task_links (task_id, conv_id, message_ids, title, url, project, created_at) values (?,?,?,?,?,?,?) on conflict (task_id) do nothing",
        r.id, String(t.conv_id), JSON.stringify(ids), String(t.title).trim(), r.url, String(t.project).trim(), Date.now(),
      );
    }
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 500 });
  }
}
