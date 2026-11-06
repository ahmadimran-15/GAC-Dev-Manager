import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { kvGet, kvSet } from "@/lib/db";

export const dynamic = "force-dynamic";

// The WhatsApp ping for each new email. Kept in the database rather than .env so it can be turned
// off from Settings without a redeploy.
export async function GET() {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  return NextResponse.json({ on: (await kvGet("email_alerts")) !== "off" });
}

export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const on = !!(await req.json().catch(() => ({}))).on;
  await kvSet("email_alerts", on ? "on" : "off");
  return NextResponse.json({ ok: true, on });
}
