import { NextResponse } from "next/server";
import { registerWebhook } from "@/lib/whatsapp";

// Adds this dashboard's webhook to the WhatsApp gateway session (keeps any other webhooks, e.g. n8n).
export async function POST(req: Request) {
  const { url } = await req.json().catch(() => ({}));
  const base = String(url || process.env.PUBLIC_URL || "").replace(/\/$/, "");
  if (!base.startsWith("https://")) return NextResponse.json({ error: "Needs a public https address. Set PUBLIC_URL in .env first." }, { status: 400 });
  try {
    await registerWebhook(`${base}/api/webhooks/whatsapp`);
    return NextResponse.json({ ok: true, url: `${base}/api/webhooks/whatsapp` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
