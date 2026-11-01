import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { handleWhatsApp } from "@/lib/inbound";
import { verifySignature } from "@/lib/whatsapp";

// The WhatsApp gateway posts message.received / message.sent here.
// Accepted when either the X-OpenWA-Signature HMAC matches, or the URL carries ?key=<WA_WEBHOOK_SECRET>
// (handy when pasting the URL into the gateway by hand).
function keyMatches(url: string) {
  const secret = process.env.WA_WEBHOOK_SECRET;
  const key = new URL(url).searchParams.get("key");
  if (!secret || !key) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-openwa-signature");
  if (process.env.WA_WEBHOOK_SECRET && !keyMatches(req.url) && !(signature && verifySignature(raw, signature))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
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
