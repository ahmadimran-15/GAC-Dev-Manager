import fs from "fs";
import path from "path";
import { MEDIA_DIR, get } from "@/lib/db";

// Serves stored voice notes and pictures to the signed-in owner.
//
// The folder is only a cache. On a host with no permanent disk (Render's free plan, a Heroku dyno)
// it is emptied on every restart and deploy, which would leave older voice notes dead in the inbox.
// The gateway still holds the original, so a missing file is fetched again from it and written back.

const typeFor = (file: string, stored?: string | null) =>
  stored && stored !== "application/octet-stream"
    ? stored
    : file.endsWith(".mp3")
      ? "audio/mpeg"
      : file.endsWith(".m4a")
        ? "audio/mp4"
        : file.endsWith(".wav")
          ? "audio/wav"
          : file.endsWith(".jpg") || file.endsWith(".jpeg")
            ? "image/jpeg"
            : file.endsWith(".png")
              ? "image/png"
              : "audio/ogg";

const headers = (type: string) => ({ "Content-Type": type, "Cache-Control": "private, max-age=86400" });

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const safe = path.basename(file);
  const full = path.join(MEDIA_DIR, safe);

  if (fs.existsSync(full)) {
    const row = await get<{ media_mime: string | null }>("select media_mime from messages where media_path = ?", safe).catch(() => undefined);
    return new Response(fs.readFileSync(full), { headers: headers(typeFor(safe, row?.media_mime)) });
  }

  // Not on disk: find which chat and message it belongs to, and ask the gateway for it again.
  const row = await get<{ mid: string | null; chat: string; account: string; media_mime: string | null }>(
    `select m.external_id as mid, m.media_mime as media_mime, c.external_id as chat, c.account as account
       from messages m join conversations c on c.id = m.conv_id
      where m.media_path = ?`,
    safe,
  ).catch(() => undefined);
  if (!row?.mid || !row.chat) return new Response("Not found", { status: 404 });

  const { downloadStoredMedia } = await import("@/lib/whatsapp");
  const got = await downloadStoredMedia(row.account, row.chat, row.mid).catch(() => null);
  if (!got) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(got.buf), { headers: headers(typeFor(got.file, got.mime ?? row.media_mime)) });
}
