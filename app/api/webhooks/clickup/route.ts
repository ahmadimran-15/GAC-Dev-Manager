import { NextResponse } from "next/server";
import { logEvent } from "@/lib/db";

// ClickUp status-change webhooks, stamped with our server time. Used later to build the
// tamper-proof time log (In Progress / In Revision = clock running).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body) logEvent("clickup", { ...body, received_at: Date.now() });
  return NextResponse.json({ ok: true });
}
