import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listConversations } from "@/lib/store";
import { runSchedules, schedulePreview, setSchedules, type Schedule } from "@/lib/schedules";

export const dynamic = "force-dynamic";

// Messages the server posts into a group at a set time each day. Owner only.
export async function GET() {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const groups = (await listConversations())
    .filter((c) => c.channel === "whatsapp" && c.externalId.endsWith("@g.us"))
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ schedules: await schedulePreview(), groups });
}

export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const b = await req.json().catch(() => ({}));

  // "Send now" from the list: ignores the clock, still respects the once-a-day marker.
  if (b.action === "run") return NextResponse.json(await runSchedules());

  if (!Array.isArray(b.schedules)) return NextResponse.json({ error: "Send the list of schedules" }, { status: 400 });
  const saved = await setSchedules(b.schedules as Partial<Schedule>[]);
  return NextResponse.json({ ok: true, schedules: saved });
}
