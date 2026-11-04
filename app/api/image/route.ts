import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readImage } from "@/lib/ai";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_PROMPT = "Read everything written in this picture and type it out exactly, keeping the order and the layout. If there is no text, describe what the picture shows.";

// Gemini likes to wrap a long answer in one code fence and open with "Here is the text…". Neither is
// part of the answer, so both are taken off before it reaches the page.
function tidy(text: string) {
  let t = text.trim().replace(/^(?:here(?:'s| is)[^\n:]*:|sure[^\n:]*:)\s*\n+/i, "");
  const fenced = t.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fenced) t = fenced[1];
  return t.trim();
}

// Reads a picture you upload or paste, answering whatever you asked about it. Nothing is stored:
// the bytes go to the Gemini server and the answer comes straight back.
export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No picture was sent" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `That picture is ${(file.size / 1048576).toFixed(1)} MB; the limit is 12 MB` }, { status: 400 });
  const mime = file.type || "image/png";
  if (!mime.startsWith("image/")) return NextResponse.json({ error: "That file is not a picture" }, { status: 400 });

  const prompt = String(form?.get("prompt") ?? "").trim() || DEFAULT_PROMPT;
  try {
    const text = await readImage(Buffer.from(await file.arrayBuffer()), mime, `${prompt}\n\nGive the answer on its own, with no introduction and no code fence.`);
    return NextResponse.json({ ok: true, text: tidy(text) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
