import { NextResponse } from "next/server";
import { taskDetail } from "@/lib/clickup";
import { summarizeTask } from "@/lib/ai";

export const dynamic = "force-dynamic";

// Task panel → "Get context": Gemini's summary of the task and its comments, plus its Loom links
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const t = await taskDetail(id);
    return NextResponse.json({ summary: await summarizeTask(t), looms: t.looms, at: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
