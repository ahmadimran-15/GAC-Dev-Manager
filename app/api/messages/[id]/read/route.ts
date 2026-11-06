import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { MEDIA_DIR } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getConversation, getMessage, updateMessage } from "@/lib/store";
import { downloadStoredMedia } from "@/lib/whatsapp";
import { geminiAudioConfigured, readImage } from "@/lib/ai";

export const dynamic = "force-dynamic";

const PROMPT =
  "Read everything written in this picture and type it out exactly, keeping the order and the layout. " +
  "If there is no text, describe in one or two short lines what the picture shows. Answer with that alone.";

// Read one picture, only when you press Read on it — the same bargain as Transcribe on a voice note:
// a day of screenshots costs nothing until you want to know what one says.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;
  const m = await getMessage(id);
  if (!m) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (m.transcript) return NextResponse.json({ ok: true, transcript: m.transcript });
  if (m.kind !== "image") return NextResponse.json({ error: "That message is not a picture" }, { status: 400 });
  if (!geminiAudioConfigured()) return NextResponse.json({ error: "The Gemini server isn't set up, so pictures can't be read." }, { status: 400 });

  try {
    let buf: Buffer | null = null;
    let mime = m.media_mime ?? "image/jpeg";
    if (m.media_path && fs.existsSync(path.join(MEDIA_DIR, m.media_path))) buf = fs.readFileSync(path.join(MEDIA_DIR, m.media_path));
    else {
      const c = await getConversation(m.conv_id);
      if (!c || c.channel !== "whatsapp") return NextResponse.json({ error: "Only WhatsApp pictures can be fetched again" }, { status: 400 });
      if (!m.external_id) return NextResponse.json({ error: "This message has no WhatsApp id, so its picture can't be fetched" }, { status: 400 });
      const got = await downloadStoredMedia(c.account, c.external_id, m.external_id);
      if (!got) return NextResponse.json({ error: "The gateway no longer has this picture" }, { status: 404 });
      buf = got.buf;
      mime = got.mime;
      await updateMessage(id, { media_path: got.file, media_mime: got.mime });
    }

    const text = (await readImage(buf, mime, PROMPT)).trim();
    if (!text) return NextResponse.json({ error: "Nothing could be made out of this picture" }, { status: 422 });
    await updateMessage(id, { transcript: text });
    return NextResponse.json({ ok: true, transcript: text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the picture" }, { status: 500 });
  }
}
