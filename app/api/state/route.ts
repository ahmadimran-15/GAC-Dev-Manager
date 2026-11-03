import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { firstReplyToday, listConversations, listDrafts } from "@/lib/store";
import { aiConfigured, transcriptionConfigured } from "@/lib/ai";
import { sttLabel, whisperConfigured } from "@/lib/stt";
import { numberNames, sessionStatus, waAccounts, withNames } from "@/lib/whatsapp";
import { listAccounts, setAccountAddress, setAccountStatus } from "@/lib/accounts";
import { clickupConfigured } from "@/lib/clickup";
import { lastHealth } from "@/lib/health";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

let waChecked = 0;

async function refreshWhatsApp() {
  const list = await waAccounts();
  await Promise.all(
    list.map(async (a) => {
      const st = await sessionStatus(a);
      if (st.phone && a.address !== st.phone) await setAccountAddress(a.id, st.phone);
      await setAccountStatus(a.id, st.status === "ready", st.status === "ready" ? undefined : `Session ${st.status}${st.pushName && st.status === "error" ? `: ${st.pushName}` : ""}`);
    }),
  );
}

// Everything the dashboard needs in one poll.
export async function GET() {
  try {
    // Refresh WhatsApp session health once a minute, in the background
    if (Date.now() - waChecked > 60_000) {
      waChecked = Date.now();
      refreshWhatsApp().catch(() => {});
    }
    const [conversations, reply, drafts, accounts, lastWa, wa, health, me] = await Promise.all([
      listConversations(),
      firstReplyToday(),
      listDrafts(),
      listAccounts(),
      get<{ created_at: number }>("select created_at from events where source = 'whatsapp' order by id desc limit 1"),
      waAccounts(),
      lastHealth(),
      currentUser(),
    ]);
    const names = await numberNames();
    return NextResponse.json({
      now: Date.now(),
      me: me ? { name: me.name, email: me.email, role: me.role } : null,
      health: health ? { at: health.at, problems: health.checks.filter((c) => c.ok === false).map((c) => `${c.name}: ${c.detail}`) } : null,
      // "@923…" mentions and "+923…" senders shown as names
      conversations: conversations.map((c) => (c.last ? { ...c, last: { ...c.last, text: withNames(c.last.text, names) } } : c)),
      drafts,
      accounts,
      stats: {
        // Clients waiting on you, and your own team waiting on you: the inbox's two sides
        waiting: conversations.filter((c) => c.waiting && c.audience === "client").length,
        teamWaiting: conversations.filter((c) => c.waiting && c.audience === "team" && c.channel !== "clickup").length,
        tasks: conversations.filter((c) => c.channel === "clickup" && c.waiting).length,
        firstReplyAvg: reply.avg,
        repliesToday: reply.count,
      },
      connections: {
        gemini: aiConfigured(),
        transcription: transcriptionConfigured(),
        whisper: whisperConfigured(),
        stt: sttLabel(),
        voiceWhisper: whisperConfigured() && process.env.VOICE_COMMANDS === "whisper",
        whatsapp: wa.length > 0,
        whatsappLastEvent: lastWa ? Number(lastWa.created_at) : null,
        whatsappSecret: !!process.env.WA_WEBHOOK_SECRET,
        reminderWhatsApp: !!process.env.REMINDER_WHATSAPP_TO,
        reminderEmail: process.env.REMINDER_EMAIL_TO || null,
        publicUrl: process.env.PUBLIC_URL || null,
        clickup: clickupConfigured(),
      },
      hasDemo: conversations.some((c) => c.demo),
    });
  } catch (e) {
    return NextResponse.json({ error: `Database error: ${e instanceof Error ? e.message : e}` }, { status: 503 });
  }
}
