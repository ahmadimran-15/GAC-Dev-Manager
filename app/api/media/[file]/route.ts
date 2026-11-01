import fs from "fs";
import path from "path";
import { MEDIA_DIR } from "@/lib/db";

// Serves stored voice notes to the signed-in owner.
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const safe = path.basename(file);
  const full = path.join(MEDIA_DIR, safe);
  if (!fs.existsSync(full)) return new Response("Not found", { status: 404 });
  const type = safe.endsWith(".mp3") ? "audio/mpeg" : "audio/ogg";
  return new Response(fs.readFileSync(full), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
}
