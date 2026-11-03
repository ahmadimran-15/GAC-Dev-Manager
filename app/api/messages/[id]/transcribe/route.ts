import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { MEDIA_DIR } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getConversation, getMessage, updateMessage } from "@/lib/store";
import { downloadStoredMedia } from "@/lib/whatsapp";
import { transcribe, transcriptionConfigured } from "@/lib/ai";

export const dynamic = "force-dynamic";

// Transcribe one voice note, only when you press Transcribe on it. Nothing is transcribed automatically,
// so a busy day of voice notes costs nothing until you actually want to read one.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;
  const m = await getMessage(id);
  if (!m) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (m.transcript) return NextResponse.json({ ok: true, transcript: m.transcript });
  if (!transcriptionConfigured()) return NextResponse.json({ error: "No transcription is set up. Add GOOGLE_AI_API_KEY or a Whisper key in .env." }, { status: 400 });

  try {
    // Use the audio we already have, else fetch just this one message's audio from the gateway
    let buf: Buffer | null = null;
    let mime = m.media_mime ?? "audio/ogg";
    if (m.media_path && fs.existsSync(path.join(MEDIA_DIR, m.media_path))) buf = fs.readFileSync(path.join(MEDIA_DIR, m.media_path));
    else {
      const c = await getConversation(m.conv_id);
      if (!c || c.channel !== "whatsapp") return NextResponse.json({ error: "Only WhatsApp voice notes can be fetched again" }, { status: 400 });
      if (!m.external_id) return NextResponse.json({ error: "This message has no WhatsApp id, so its audio can't be fetched" }, { status: 400 });
      const got = await downloadStoredMedia(c.account, c.external_id, m.external_id);
      if (!got) return NextResponse.json({ error: "The gateway no longer has this audio" }, { status: 404 });
      buf = got.buf;
      mime = got.mime;
      await updateMessage(id, { media_path: got.file, media_mime: got.mime });
    }

    const text = await transcribe(buf, mime);
    if (!text) return NextResponse.json({ error: "Nothing could be made out of this audio" }, { status: 422 });
    await updateMessage(id, { transcript: text });
    return NextResponse.json({ ok: true, transcript: text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Transcription failed" }, { status: 500 });
  }
}
