import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { MEDIA_DIR } from "@/lib/db";
import { addMessage, getConversation } from "@/lib/store";
import { sendWhatsAppMedia } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const MAX = 25 * 1024 * 1024; // WhatsApp's own limit for most media

// Send a picture, video or file into a WhatsApp conversation from the inbox.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;

  const conv = await getConversation(id);
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (conv.channel !== "whatsapp") return NextResponse.json({ error: "Files can only be sent on WhatsApp for now" }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No file was sent" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 25 MB` }, { status: 400 });

  const caption = String(form?.get("caption") ?? "").trim();
  const from = String(form?.get("from") ?? "").trim() || conv.account;
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";

  const r = await sendWhatsAppMedia(from, conv.external_id, { buf, mime, name: file.name }, { caption });
  if (!r.ok) return NextResponse.json({ error: r.error ?? "Send failed", uncertain: r.uncertain }, { status: 502 });

  // Keep our own copy so the thread can show it straight away rather than asking the gateway for
  // something it has only just been handed.
  let saved: string | null = null;
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    saved = `out-${Date.now()}-${(file.name || "file").replace(/[^\w.-]/g, "").slice(-40)}`;
    fs.writeFileSync(path.join(MEDIA_DIR, saved), buf);
  } catch {
    saved = null;
  }

  const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "voice" : "file";
  await addMessage({
    conv_id: id,
    direction: "out",
    kind,
    text: caption,
    media_path: saved,
    media_mime: mime,
    external_id: r.id ?? null,
    sent_by: "me",
    status: r.simulated ? "simulated" : "sent",
    via: "WhatsApp",
  });
  return NextResponse.json({ ok: true, kind, simulated: r.simulated });
}
