import { NextResponse } from "next/server";
import { allProjects, markCurrent, projectFolders } from "@/lib/clickup";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Which ClickUp folders (and single projects) count as current in GAC Desk: their tasks show on the
// Team page and new tasks can go into them. ClickUp's API can't move a list into another folder,
// so a project from Pending From Client is brought up by marking it here.
export async function GET(req: Request) {
  const me = await currentUser();
  if (me?.role !== "admin") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const force = new URL(req.url).searchParams.has("refresh");
    const [folders, projects] = await Promise.all([projectFolders(force), allProjects()]);
    return NextResponse.json({
      folders: folders.map((f) => ({ ...f, tasks: projects.filter((p) => p.stage === f.name).length })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, stage: p.stage, current: p.current })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 500 });
  }
}

// { kind: "folder" | "project", id, on }
export async function POST(req: Request) {
  const me = await currentUser();
  if (me?.role !== "admin") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (b.kind !== "folder" && b.kind !== "project") return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  if (!b.id) return NextResponse.json({ error: "Which one?" }, { status: 400 });
  try {
    await markCurrent(b.kind, String(b.id), !!b.on);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
