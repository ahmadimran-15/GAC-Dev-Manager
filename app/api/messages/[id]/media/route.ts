import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { MEDIA_DIR, get } from "@/lib/db";

export const dynamic = "force-dynamic";

// The picture, video or file of one message, for showing it in the thread.
//
// Nothing is downloaded when a message arrives: the gateway keeps the file, and it is fetched the
// first time someone actually looks at it, then kept on disk so a second look is free. That way a
// day of photos costs nothing until they are opened, and a host that wipes the disk only means the
// next look fetches again.

const typeFor = (file: string, stored?: string | null) => {
  if (stored && stored !== "application/octet-stream") return stored;
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return (
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", pdf: "application/pdf" }[ext] ??
    "application/octet-stream"
  );
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await get<{ media_path: string | null; media_mime: string | null; kind: string; mid: string | null; chat: string; account: string }>(
    `select m.media_path, m.media_mime, m.kind, m.external_id as mid, c.external_id as chat, c.account as account
       from messages m join conversations c on c.id = m.conv_id
      where m.id = ?`,
    id,
  ).catch(() => undefined);
  if (!row) return new Response("Not found", { status: 404 });
  if (row.kind === "text") return new Response("That message has no file", { status: 400 });

  // Already on disk from an earlier look (or from the SOD/EOD check)
  if (row.media_path) {
    const full = path.join(MEDIA_DIR, path.basename(row.media_path));
    if (fs.existsSync(full)) {
      return new Response(new Uint8Array(fs.readFileSync(full)), {
        headers: { "Content-Type": typeFor(row.media_path, row.media_mime), "Cache-Control": "private, max-age=86400" },
      });
    }
  }

  if (!row.mid || !row.chat) return new Response("Not found", { status: 404 });
  const { downloadStoredMedia } = await import("@/lib/whatsapp");
  const got = await downloadStoredMedia(row.account, row.chat, row.mid).catch(() => null);
  if (!got) return new Response("The gateway no longer has this file", { status: 404 });
  const { updateMessage } = await import("@/lib/store");
  await updateMessage(id, { media_path: got.file, media_mime: got.mime }).catch(() => {});
  return new Response(new Uint8Array(got.buf), {
    headers: { "Content-Type": typeFor(got.file, got.mime), "Cache-Control": "private, max-age=86400" },
  });
}

export async function HEAD(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await GET(req, ctx);
  return new NextResponse(null, { status: r.status, headers: r.headers });
}
