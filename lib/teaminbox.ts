import { all, get } from "@/lib/db";
import { getConversation, getMessages, listConversations, type Message } from "@/lib/store";
import { onTeamAccount, teamWaAccounts } from "@/lib/team-access";
import { teamNumbers } from "@/lib/team-numbers";
import { waAccounts, withNames } from "@/lib/whatsapp";

// What the team's WhatsApp inbox is allowed to see. Everything a teammate could use to reach a client
// directly is removed here, on the server: no phone numbers, group ids or emails ever leave this file,
// first names only, the last few days only, voice notes as their transcript.
export const HISTORY_DAYS = 3;

// "Mr. Fazil Khan" → "Fazil", "M Yousaf Imran" → "Yousaf"
export const firstName = (name: string) =>
  name.trim().split(/\s+/).find((w) => w.length > 1 && !/^(mr|mrs|ms|miss|dr|sir|engr|eng|mian|syed)\.?$/i.test(w)) ?? name.trim().split(/\s+/)[0] ?? "";
const isNumber = (s: string) => /^\+?[\d\s()-]{6,}$/.test(s.trim());

// Phone numbers, WhatsApp ids and email addresses anywhere in a text. A number counts when it has 9+
// digits, so dates, amounts and "1. 2. 3." lists stay; brackets, dots and spaces inside it are allowed
// ("+1 (305) 508-3815"), which is how people actually type a number into a chat.
export const scrub = (s: string) =>
  s
    .replace(/\d[\d\s-]*@(g\.us|c\.us|s\.whatsapp\.net|lid)\b/gi, "[chat]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(?<![\w@/])\+?\d[\d\s().-]{6,}\d(?![\w/])/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[number]" : m));

// Only our own side is ever named. A client keeps their name out of the team's view even when the
// phone has them saved as a contact, so every chat that is not one of ours simply reads "Client".
function label(c: { name: string; externalId: string }, names: Map<string, string>) {
  if (c.externalId.endsWith("@g.us")) return isNumber(c.name) ? "Group" : scrub(c.name);
  // Matched on the chat's own number, not its saved name, so it works whichever way it was stored.
  const n = names.get(c.externalId.replace(/\D/g, "")) ?? names.get(c.name.replace(/\D/g, "")) ?? "";
  return n && !isNumber(n) ? firstName(n) : "Client";
}

// "M Yousaf Imran: hello" → "Yousaf: hello" (group senders), then numbers/ids/emails removed
function teamText(text: string, group: boolean, names: Map<string, string>) {
  let t = withNames(text, names, true);
  if (group) t = t.replace(/^([^:\n]{1,40}): /, (_, who: string) => `${isNumber(who) ? "someone" : firstName(who)}: `);
  return scrub(t);
}

const body = (m: Message) => m.text || m.transcript || (m.kind === "voice" ? "🎤 Voice note (no transcript yet)" : m.kind === "image" ? "🖼 Image" : m.kind === "file" ? "📎 File" : "");

// Only our own side is named here: the numbers saved in Settings → Team numbers, plus your own
// connected numbers. The phone's contact book is deliberately not used — a client saved as
// "Fazil Khan" would otherwise be named to the team, which is the thing we are preventing.
const shortNames = async () => {
  const map = new Map<string, string>();
  const [team, accounts, owner] = await Promise.all([
    teamNumbers(),
    waAccounts(),
    get<{ name: string }>("select name from users where role = 'admin' order by created_at limit 1").catch(() => null),
  ]);
  for (const t of team) if (t.number && t.name) map.set(t.number, firstName(t.name));
  for (const a of accounts) if (owner?.name && a.address && /^\d+$/.test(a.address)) map.set(a.address, firstName(owner.name));
  return map;
};
// Chats with our own numbers (e.g. the reminders you get on WhatsApp) aren't client chats
const ourOwn = async () => new Set((await waAccounts()).map((a) => a.address).filter(Boolean));

// The numbers this person may see: their own list if the owner set one, otherwise the shared list.
async function allowedFor(meId?: string) {
  if (meId) {
    const { getUser } = await import("@/lib/users");
    const me = await getUser(meId).catch(() => null);
    if (me?.waAccounts.length) return me.waAccounts;
  }
  return teamWaAccounts();
}

export async function teamChats(meId?: string) {
  const [names, own, allowed] = await Promise.all([shortNames(), ourOwn(), allowedFor(meId)]);
  const list = (await listConversations()).filter((c) => c.channel === "whatsapp" && !c.internal && !c.demo && !own.has(c.externalId) && onTeamAccount(allowed, c.account));
  return {
    now: Date.now(),
    chats: list.map((c) => {
      const group = c.externalId.endsWith("@g.us");
      return {
        id: c.id,
        label: label(c, names),
        group,
        project: c.project,
        waiting: c.waiting,
        waitingSince: c.waitingSince,
        last: c.last ? { text: teamText(c.last.text, group, names).replace(/\s*\n+\s*/g, " · ").slice(0, 140), direction: c.last.direction, at: c.last.at } : null,
      };
    }),
  };
}

export async function teamThread(convId: string, meId: string) {
  const [names, own, allowed] = await Promise.all([shortNames(), ourOwn(), allowedFor(meId)]);
  const c = await getConversation(convId);
  if (!c || c.channel !== "whatsapp" || c.internal || c.demo || own.has(c.external_id) || !onTeamAccount(allowed, c.account)) return null;
  const group = c.external_id.endsWith("@g.us");
  const since = Date.now() - HISTORY_DAYS * 86400_000;
  const msgs = (await getMessages(convId)).filter((m) => Number(m.created_at) >= since).slice(-80);
  const pending = await all<{ id: string; text: string; created_at: number; status: string }>(
    "select id, text, created_at, status from drafts where conv_id = ? and author_id = ? and created_at >= ? order by created_at",
    convId,
    meId,
    since,
  );
  return {
    now: Date.now(),
    chat: { id: c.id, label: label({ name: c.name, externalId: c.external_id }, names), group, project: c.project, days: HISTORY_DAYS },
    messages: msgs.map((m) => {
      // A teammate (team number) in the group shows with their name; your own replies as "Manager"
      const teammate = m.direction === "out" && m.sent_by && !["me", "phone"].includes(m.sent_by) && (m.text ?? "").startsWith(`${m.sent_by}: `);
      const text = teamText(teammate ? body(m).slice(m.sent_by!.length + 2) : body(m), group && m.direction === "in", names);
      return {
        id: m.id,
        direction: m.direction,
        at: Number(m.created_at),
        text,
        by: m.direction === "in" ? null : teammate ? firstName(m.sent_by!) : m.sent_by && !["me", "phone"].includes(m.sent_by) ? `${firstName(m.sent_by)} (approved)` : "Manager",
        ours: m.direction === "out" && !teammate,
        // Delivery ticks, same as the owner's inbox: sent → delivered → read
        status: m.direction === "out" ? (m.status ?? null) : null,
      };
    }),
    mine: pending.map((d) => ({ ...d, created_at: Number(d.created_at) })),
  };
}
