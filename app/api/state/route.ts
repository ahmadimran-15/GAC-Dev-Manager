import { NextResponse } from "next/server";
import { all, kvGet } from "@/lib/db";
import { firstReplyToday, listConversations, listDrafts } from "@/lib/store";
import { aiConfigured, transcriptionConfigured } from "@/lib/ai";
import { whisperConfigured } from "@/lib/stt";
import { sessionStatus, waConfigured } from "@/lib/whatsapp";
import { emailAccounts } from "@/lib/email";
import { clickupConfigured } from "@/lib/clickup";

export const dynamic = "force-dynamic";

let waCache: { at: number; v: Awaited<ReturnType<typeof sessionStatus>> } | null = null;

// Everything the dashboard needs in one poll.
export async function GET() {
  const conversations = listConversations();
  const drafts = listDrafts();
  const reply = firstReplyToday();
  const lastWa = all<{ created_at: number }>("select created_at from events where source = 'whatsapp' order by id desc limit 1")[0];
  if (waConfigured() && (!waCache || Date.now() - waCache.at > 60_000)) waCache = { at: Date.now(), v: await sessionStatus() };
  return NextResponse.json({
    now: Date.now(),
    conversations,
    drafts,
    stats: {
      waiting: conversations.filter((c) => c.waiting).length,
      firstReplyAvg: reply.avg,
      repliesToday: reply.count,
    },
    connections: {
      gemini: aiConfigured(),
      transcription: transcriptionConfigured(),
      whisper: whisperConfigured(),
      whatsapp: waConfigured(),
      whatsappSession: waCache?.v ?? null,
      whatsappLastEvent: lastWa?.created_at ?? null,
      whatsappSecret: !!process.env.WA_WEBHOOK_SECRET,
      reminderWhatsApp: !!process.env.REMINDER_WHATSAPP_TO,
      publicUrl: process.env.PUBLIC_URL || null,
      clickup: clickupConfigured(),
      email: emailAccounts().map((a) => ({ label: a.label, user: a.user, status: JSON.parse(kvGet(`email_status_${a.label}`) ?? "null") })),
    },
    hasDemo: conversations.some((c) => c.demo),
  });
}
