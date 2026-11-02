import { NextResponse } from "next/server";
import { allProjects } from "@/lib/clickup";

export const dynamic = "force-dynamic";

// Project names from every ClickUp folder for the task form's picker. ?refresh re-reads ClickUp.
export async function GET(req: Request) {
  try {
    const projects = await allProjects(new URL(req.url).searchParams.has("refresh"));
    return NextResponse.json({ projects: projects.map((p) => ({ name: p.name, stage: p.stage, current: p.current })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 500 });
  }
}
