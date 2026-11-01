import { NextResponse } from "next/server";
import { sendToTarget } from "@/lib/inbound";

// New message to anyone: a WhatsApp group/contact from your lists, or an email address.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!String(b.text ?? "").trim()) return NextResponse.json({ error: "Write a message first" }, { status: 400 });
  if (!b.to) return NextResponse.json({ error: "Pick who it goes to" }, { status: 400 });
  try {
    return NextResponse.json(await sendToTarget({ channel: b.channel, from: b.from, to: b.to, toName: b.toName, subject: b.subject, text: String(b.text).trim() }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
