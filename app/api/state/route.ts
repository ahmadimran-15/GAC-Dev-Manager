import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { firstReplyToday, listConversations, listDrafts } from "@/lib/store";
import { aiConfigured, transcriptionConfigured } from "@/lib/ai";
import { sttLabel, whisperConfigured } from "@/lib/stt";
import { sessionStatus, waAccounts } from "@/lib/whatsapp";
import { listAccounts, setAccountAddress, setAccountStatus } from "@/lib/accounts";
import { clickupConfigured } from "@/lib/clickup";

export const dynamic = "force-dynamic";

let waChecked = 0;

// Everything the dashboard needs in one poll.
export async function GET() {
  // Refresh WhatsApp session health once a minute
  if (Date.now() - waChecked > 60_000) {
    waChecked = Date.now();
    await Promise.all(
      waAccounts().map(async (a) => {
        const st = await sessionStatus(a);
        if (st.phone && a.address !== st.phone) setAccountAddress(a.id, st.phone);
        setAccountStatus(a.id, st.status === "ready", st.status === "ready" ? undefined : `Session ${st.status}${st.pushName && st.status === "error" ? `: ${st.pushName}` : ""}`);
      }),
    );
  }
  const conversations = listConversations();
  const reply = firstReplyToday();
  const lastWa = all<{ created_at: number }>("select created_at from events where source = 'whatsapp' order by id desc limit 1")[0];
  return NextResponse.json({
    now: Date.now(),
    conversations,
    drafts: listDrafts(),
    accounts: listAccounts(),
    stats: {
      waiting: conversations.filter((c) => c.waiting).length,
      firstReplyAvg: reply.avg,
      repliesToday: reply.count,
    },
    connections: {
      gemini: aiConfigured(),
      transcription: transcriptionConfigured(),
      whisper: whisperConfigured(),
      stt: sttLabel(),
      voiceWhisper: whisperConfigured() && process.env.VOICE_COMMANDS === "whisper",
      whatsapp: waAccounts().length > 0,
      whatsappLastEvent: lastWa?.created_at ?? null,
      whatsappSecret: !!process.env.WA_WEBHOOK_SECRET,
      reminderWhatsApp: !!process.env.REMINDER_WHATSAPP_TO,
      publicUrl: process.env.PUBLIC_URL || null,
      clickup: clickupConfigured(),
    },
    hasDemo: conversations.some((c) => c.demo),
  });
}
