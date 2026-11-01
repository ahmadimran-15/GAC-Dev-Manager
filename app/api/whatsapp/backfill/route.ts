import { NextResponse } from "next/server";
import { backfillRunning, backfillWhatsApp, lastBackfill } from "@/lib/backfill";
import { logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ last: await lastBackfill(), running: backfillRunning() });
}

// Settings → "Import recent chats": starts the import in the background (it can take a few minutes)
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const days = b.days ? Math.min(30, Math.max(1, Number(b.days))) : undefined;
  const full = !!b.full;
  if (b.wait) {
    try {
      return NextResponse.json(await backfillWhatsApp({ days, full }));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 502 });
    }
  }
  backfillWhatsApp({ days, full }).catch((e) => logEvent("backfill-error", String(e)).catch(() => {}));
  return NextResponse.json({ started: true, running: backfillRunning() });
}
