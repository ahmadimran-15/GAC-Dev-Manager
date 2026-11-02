import { NextResponse } from "next/server";
import { syncTaskComments, taskConversation } from "@/lib/taskchat";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Opens this task's comment thread in the inbox: reads its comments from ClickUp first, so the
// thread is up to date, then redirects to it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const base = new URL(req.url).origin;
  try {
    const conv = (await syncTaskComments(id)).conv ?? (await taskConversation(id));
    return NextResponse.redirect(`${base}/inbox?c=${conv.id}`);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 500 });
  }
}
