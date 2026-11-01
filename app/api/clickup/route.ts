import { NextResponse } from "next/server";
import { clickupWebhookInfo, ensureClickupWebhook } from "@/lib/clickup";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await clickupWebhookInfo());
}

// Settings → "Register ClickUp webhook" (re-points ours to PUBLIC_URL; n8n's webhooks are left alone)
export async function POST() {
  try {
    const r = await ensureClickupWebhook(true);
    return NextResponse.json({ ok: true, endpoint: r.endpoint, id: r.id, signed: !!r.secret });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp failed" }, { status: 502 });
  }
}
