import { NextResponse } from "next/server";
import { moveProjectToFolder } from "@/lib/clickup";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Moves a whole project (a ClickUp list) into another folder. ClickUp has no endpoint for this, so the
// list is remade in the target folder, every task is moved across, and the empty original is removed.
// Only runs when the owner confirms it in the assistant.
export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const b = await req.json().catch(() => ({}));
  if (!b.project || !b.folder) return NextResponse.json({ error: "Which project, and into which folder?" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await moveProjectToFolder(String(b.project), String(b.folder))) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 500 });
  }
}
