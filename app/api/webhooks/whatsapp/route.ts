import { NextResponse } from "next/server";
import { handleWhatsApp } from "@/lib/inbound";
import { verifySignature } from "@/lib/whatsapp";

// The WhatsApp gateway posts message.received / message.sent here (registered from Settings).
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-openwa-signature"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await handleWhatsApp(body)) });
  } catch (e) {
    // Answer 200 so the gateway doesn't retry forever; the error is in the events log
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "WhatsApp webhook endpoint. The gateway sends POST requests here." });
}
