import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getConversation } from "@/lib/store";
import { checkRecent, watchesShiftCheck } from "@/lib/shiftcheck";

export const dynamic = "force-dynamic";

// The manual check behind the "Check SOD/EOD" button: re-reads the pictures of the last day in this
// chat and says what arrived and what is missing. It answers here only — nothing is posted to the chat.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  if (conv.channel !== "whatsapp") return NextResponse.json({ error: "Only WhatsApp chats hold shift screenshots" }, { status: 400 });

  const hours = Math.min(Math.max(Number(new URL(req.url).searchParams.get("hours") ?? 24), 1), 168);
  try {
    const r = await checkRecent(conv, hours);
    return NextResponse.json({ ok: true, watched: await watchesShiftCheck(conv), ...r });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
