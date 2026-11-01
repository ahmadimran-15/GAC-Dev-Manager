import { NextResponse } from "next/server";
import { lastHealth, runHealth } from "@/lib/health";
import { getAccount } from "@/lib/accounts";
import { sessionQr, startSession } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await lastHealth();
  if (!h || Date.now() - h.at > 15 * 60_000) return NextResponse.json(await runHealth());
  return NextResponse.json(h);
}

// Recheck now, restart a WhatsApp session, or fetch its QR code for re-linking.
export async function POST(req: Request) {
  const { action, id } = await req.json().catch(() => ({}));
  try {
    if (action === "recheck") return NextResponse.json(await runHealth());
    const a = id ? await getAccount(id) : null;
    if (!a || a.kind !== "whatsapp") return NextResponse.json({ error: "Pick a WhatsApp number" }, { status: 400 });
    if (action === "wa-start") {
      const st = await startSession(a);
      return NextResponse.json({ status: st.status, health: await runHealth() });
    }
    if (action === "wa-qr") return NextResponse.json({ qr: await sessionQr(a) });
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
