import { NextResponse } from "next/server";
import { whisper, whisperConfigured } from "@/lib/stt";

// Your own voice commands, recorded in the browser and transcribed with Whisper.
export async function POST(req: Request) {
  if (!whisperConfigured()) return NextResponse.json({ error: "Add WHISPER_API_KEY to .env" }, { status: 400 });
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No audio" }, { status: 400 });
  const lang = String(form.get("lang") ?? "").split("-")[0] || undefined;
  try {
    return NextResponse.json({ text: await whisper(Buffer.from(await file.arrayBuffer()), file.type || "audio/webm", lang) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Transcription failed" }, { status: 502 });
  }
}
