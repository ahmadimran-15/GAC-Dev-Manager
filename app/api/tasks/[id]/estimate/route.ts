import { NextResponse } from "next/server";
import { aiEstimate, getEstimate, setMyEstimate } from "@/lib/estimates";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json((await getEstimate(id)) ?? { task_id: id, my_min: null, ai_min: null, ai_note: null });
}

// {myMin: number|null} saves your own estimate; {ai: true} asks Gemini for a projection.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.ai) {
      await aiEstimate(id);
    } else if ("myMin" in b) {
      const m = b.myMin === null || b.myMin === "" ? null : Math.round(Number(b.myMin));
      if (m !== null && (!Number.isFinite(m) || m < 1 || m > 100_000)) return NextResponse.json({ error: "Enter minutes, e.g. 90" }, { status: 400 });
      await setMyEstimate(id, m);
    } else return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    return NextResponse.json(await getEstimate(id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
