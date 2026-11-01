import { NextResponse } from "next/server";
import { trackGroup, trackedGroups, untrackGroup } from "@/lib/groups";

export const dynamic = "force-dynamic";

// WhatsApp groups whose messages come into the inbox.
export async function GET() {
  return NextResponse.json({ groups: await trackedGroups() });
}

export async function POST(req: Request) {
  const { action, id, name } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Pick a group" }, { status: 400 });
  if (action === "track") await trackGroup(id, name || "WhatsApp group");
  else await untrackGroup(id);
  return NextResponse.json({ ok: true, groups: await trackedGroups() });
}
