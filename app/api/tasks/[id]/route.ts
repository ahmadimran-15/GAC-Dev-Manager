import { NextResponse } from "next/server";
import { taskDetail } from "@/lib/clickup";

// One task with its comments, where the team posts Loom links and work updates.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await taskDetail(id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 502 });
  }
}
