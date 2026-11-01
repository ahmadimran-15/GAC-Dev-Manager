import { all, kvGet, kvSet, logEvent, run } from "@/lib/db";
import { trackGroup, trackedGroups } from "@/lib/groups";
import { groupMembers, listChats, listTargets, messagesSince, senderPhone, sessionStatus, waAccounts, type Incoming } from "@/lib/whatsapp";
import { teamNumbers } from "@/lib/team-numbers";
import { findOrCreateConversation, insertMessages, updateConversation } from "@/lib/store";

// Imports earlier WhatsApp messages from the gateway's own log so the inbox knows who is still waiting
// after the session (re)connects or this server was down. Runs on startup, whenever a session comes back
// to "ready", and from Settings. Each run continues where the last one stopped.
//
// Same rules as live messages: you or a team number (Settings → team numbers) writing = our reply.
// Direct chats are all imported; groups only when they are already tracked or a team number is in them
// (client groups), so family and community groups stay out of the inbox.

const DAY = 86_400_000;

export interface BackfillResult {
  at: number;
  tookMs: number;
  accounts: { account: string; scanned: number; chats: number; groups: number; stored: number; skipped?: string }[];
  newConversations: number;
  markedHandled: number;
}

let running: Promise<BackfillResult> | null = null;
let progress = { phase: "", scanned: 0 };

export const backfillRunning = () => (running ? { ...progress } : null);

// full=true re-reads the whole window instead of continuing from the last run
export function backfillWhatsApp(opts: { days?: number; full?: boolean } = {}) {
  running ??= doBackfill(opts).finally(() => (running = null));
  return running;
}

async function doBackfill({ days = Number(process.env.BACKFILL_DAYS ?? 7), full = false }: { days?: number; full?: boolean }): Promise<BackfillResult> {
  const started = Date.now();
  const report: BackfillResult["accounts"] = [];
  const team = await teamNumbers();
  const tracked = await trackedGroups();
  const teammateOf = async (a: Parameters<typeof senderPhone>[0], m: Incoming) => {
    if (m.fromMe || !m.senderId) return null;
    const phone = await senderPhone(a, m.senderId);
    return team.find((t) => t.number === phone)?.name ?? null;
  };

  for (const a of await waAccounts()) {
    const st = await sessionStatus(a);
    if (st.status !== "ready") {
      report.push({ account: a.label, scanned: 0, chats: 0, groups: 0, stored: 0, skipped: `session ${st.status}` });
      continue;
    }
    const key = `wa_backfill_${a.id}`;
    const last = Number((await kvGet(key)) ?? 0);
    const since = Math.max(started - days * DAY, last && !full ? last - 3600_000 : 0);
    progress = { phase: `Reading WhatsApp history (${a.label})`, scanned: 0 };
    const msgs = await messagesSince(a, since, (n) => (progress.scanned = n));
    const names = new Map((await listChats(a).catch(() => [])).map((c) => [c.id, c.name]));
    const contacts = new Map((await listTargets(a, "contacts").catch(() => [])).map((t) => [t.number ?? "", t.name]));

    // Group by chat; who wrote each message (stored history has the sender's id, not their name)
    const byChat = new Map<string, { m: Incoming; teammate: string | null }[]>();
    for (const m of msgs) {
      if (m.isGroup && !m.fromMe && (!m.author || /@(c\.us|lid)$|^\d+$/.test(m.author))) {
        const phone = await senderPhone(a, m.senderId || m.author);
        m.author = contacts.get(phone) ?? (phone ? `+${phone}` : "");
      }
      const list = byChat.get(m.chatId) ?? [];
      list.push({ m, teammate: await teammateOf(a, m) });
      byChat.set(m.chatId, list);
    }
    await repairSenderNames(a, contacts);

    let stored = 0;
    let chats = 0;
    let groups = 0;
    progress.phase = "Saving messages";
    for (const [chatId, list] of byChat) {
      const isGroup = list[0].m.isGroup;
      if (isGroup) {
        // A client group has someone from our team in it (your own family/friends groups don't)
        const client = tracked[chatId] || list.some((x) => x.teammate) || (await groupMembers(a, chatId)).some((n) => team.some((t) => t.number === n));
        if (!client) continue;
        const name = tracked[chatId] ?? names.get(chatId) ?? (list.find((x) => x.m.name && x.m.name !== chatId)?.m.name || "WhatsApp group");
        if (!tracked[chatId]) await trackGroup(chatId, name);
        groups++;
      }
      // Direct chats are keyed by the client's number (your own messages carry who you wrote to)
      const externalId = isGroup ? chatId : list[0].m.phone;
      const theirName = isGroup ? (tracked[chatId] ?? names.get(chatId) ?? "WhatsApp group") : (list.find((x) => !x.m.fromMe && x.m.name && !/^\d+$/.test(x.m.name))?.m.name ?? externalId);
      const teammateChat = !isGroup ? (list.find((x) => x.teammate)?.teammate ?? null) : null;
      const conv = await findOrCreateConversation({ channel: "whatsapp", externalId, account: a.id, name: teammateChat ?? theirName });
      if (teammateChat && !conv.internal) await updateConversation(conv.id, { internal: 1 });

      const known = new Set((await all<{ external_id: string }>("select external_id from messages where conv_id = ? and external_id is not null", conv.id)).map((r) => r.external_id));
      const rows = list
        .filter((x) => !known.has(x.m.id))
        .map(({ m, teammate }) => {
          const ours = m.fromMe || (isGroup && !!teammate);
          return {
            conv_id: conv.id,
            direction: (ours ? "out" : "in") as "in" | "out",
            kind: m.kind,
            text: (isGroup && !m.fromMe ? `${teammate ?? m.author}${teammate || m.author ? ": " : ""}${m.text}` : m.text) || null,
            external_id: m.id,
            sent_by: m.fromMe ? "phone" : isGroup ? teammate : null,
            status: ours ? "sent" : null,
            via: a.label,
            created_at: m.at,
          };
        });
      if (!rows.length) continue;
      await insertMessages(rows);
      stored += rows.length;
      chats++;
      // New client messages reopen the chat, like live ones do
      if (rows.some((r) => r.direction === "in")) await run("update conversations set status = 'open', reminded_at = null where id = ? and status = 'handled' and ? > coalesce((select max(created_at) from messages where conv_id = ? and direction = 'out'), 0)", conv.id, Math.max(...rows.filter((r) => r.direction === "in").map((r) => r.created_at)), conv.id);
    }
    await kvSet(key, String(started));
    report.push({ account: a.label, scanned: msgs.length, chats, groups, stored });
  }

  // Chats seen for the first time whose client message is old aren't "waiting" anymore: mark them handled
  // so reminders cover recent messages only. A new message reopens them.
  const stale = Number(process.env.BACKFILL_WAITING_HOURS ?? 24) * 3600_000;
  const fresh = await all<{ id: string }>(
    `select c.id from conversations c where c.created_at >= ? and c.status = 'open'
       and (select max(created_at) from messages m where m.conv_id = c.id and m.direction = 'in') < ?
       and coalesce((select max(created_at) from messages m where m.conv_id = c.id and m.direction = 'out'), 0) < (select max(created_at) from messages m where m.conv_id = c.id and m.direction = 'in')`,
    started,
    started - stale,
  );
  for (const r of fresh) await run("update conversations set status = 'handled' where id = ?", r.id);
  const created = Number((await all<{ n: number }>("select count(*) n from conversations where created_at >= ?", started))[0]?.n ?? 0);

  const result: BackfillResult = { at: started, tookMs: Date.now() - started, accounts: report, newConversations: created, markedHandled: fresh.length };
  await kvSet("wa_backfill_last", JSON.stringify(result));
  await logEvent("backfill", result).catch(() => {});
  return result;
}

// Group messages saved as "923…@c.us: text" (before names were looked up) get the sender's name instead
async function repairSenderNames(a: Parameters<typeof senderPhone>[0], contacts: Map<string, string>) {
  const rows = await all<{ id: string; text: string }>("select id, text from messages where direction = 'in' and (text like '%@c.us: %' or text like '%@lid: %')");
  for (const r of rows) {
    const m = r.text.match(/^(\d+@(?:c\.us|lid)): ([\s\S]*)$/);
    if (!m) continue;
    const phone = await senderPhone(a, m[1]);
    await run("update messages set text = ? where id = ?", `${contacts.get(phone) ?? (phone ? `+${phone}` : "Someone")}: ${m[2]}`, r.id);
  }
}

export async function lastBackfill(): Promise<BackfillResult | null> {
  return JSON.parse((await kvGet("wa_backfill_last")) ?? "null");
}
