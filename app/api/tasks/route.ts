import { NextResponse } from "next/server";
import { createTask } from "@/lib/clickup";

export async function POST(req: Request) {
  const t = await req.json().catch(() => ({}));
  if (!String(t.title ?? "").trim() || !String(t.project ?? "").trim()) return NextResponse.json({ error: "Title and project are required" }, { status: 400 });
  try {
    return NextResponse.json(await createTask({ title: t.title, description: t.description ?? "", project: t.project, assignee: t.assignee, priority: t.priority, due: t.due }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 502 });
  }
}
