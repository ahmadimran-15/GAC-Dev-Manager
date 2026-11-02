import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { teamChats, teamThread } from "@/lib/teaminbox";

export const dynamic = "force-dynamic";

// The team's WhatsApp inbox. Everything it may show is decided in lib/teaminbox.ts: no phone numbers,
// group ids or emails ever reach this response. Replies go to the owner for approval (POST /api/portal).
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const convId = new URL(req.url).searchParams.get("c");
  if (!convId) return NextResponse.json(await teamChats());
  const thread = await teamThread(convId, me.id);
  return thread ? NextResponse.json(thread) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
