import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { get } from "@/lib/db";
import { updateMessage } from "@/lib/store";
import { reactWhatsApp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// React to a WhatsApp message, or take the reaction off again with an empty emoji.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;
  const emoji = String((await req.json().catch(() => ({}))).emoji ?? "").trim();

  const row = await get<{ mid: string | null; chat: string; account: string; channel: string; reaction: string | null }>(
    `select m.external_id as mid, m.reaction as reaction, c.external_id as chat, c.account as account, c.channel as channel
       from messages m join conversations c on c.id = m.conv_id where m.id = ?`,
    id,
  ).catch(() => undefined);
  if (!row?.mid) return NextResponse.json({ error: "That message has no WhatsApp id to react to" }, { status: 400 });
  if (row.channel !== "whatsapp") return NextResponse.json({ error: "Reactions are WhatsApp only for now" }, { status: 400 });

  // Tapping the same one again takes it off, the way it does in WhatsApp itself.
  const next = row.reaction === emoji ? "" : emoji;
  const r = await reactWhatsApp(row.account, row.chat, row.mid, next);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  await updateMessage(id, { reaction: next || null });
  return NextResponse.json({ ok: true, reaction: next || null });
}
