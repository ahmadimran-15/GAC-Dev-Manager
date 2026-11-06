import { kvGet, kvSet, logEvent } from "@/lib/db";
import { listConversations } from "@/lib/store";

// Messages the server posts into a WhatsApp group at a fixed time every day — the SOD and EOD nudges
// in the Ladeena group, for example. Set up in Settings; nothing is hard-coded here.
//
// "@Ali" in the text becomes a real WhatsApp mention on the way out, the same as a reply you type
// yourself, so the person is actually notified rather than just reading their name.

const KEY = "scheduled_messages";
const TZ_DEFAULT = process.env.AI_HOURS_TZ || "Asia/Karachi";

export interface Schedule {
  id: string;
  enabled: boolean;
  label: string; // "Ladeena SOD"
  chat: string; // conversation id, or a group name to match
  time: string; // "11:00", in tz
  days: number[]; // 0=Sunday … 6=Saturday; empty = every day
  text: string;
  tz?: string;
}

const uid = () => `s_${Math.random().toString(36).slice(2, 10)}`;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function schedules(): Promise<Schedule[]> {
  try {
    const saved = JSON.parse((await kvGet(KEY)) ?? "null");
    return Array.isArray(saved) ? saved.map(clean) : [];
  } catch {
    return [];
  }
}

function clean(s: Partial<Schedule>): Schedule {
  return {
    id: String(s.id || uid()),
    enabled: s.enabled !== false,
    label: String(s.label ?? "").trim() || "Scheduled message",
    chat: String(s.chat ?? "").trim(),
    time: HHMM.test(String(s.time)) ? String(s.time) : "09:00",
    days: Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [],
    text: String(s.text ?? "").trim(),
    tz: s.tz ? String(s.tz) : undefined,
  };
}

export async function setSchedules(list: Partial<Schedule>[]) {
  const out = list.map(clean).filter((s) => s.chat && s.text);
  await kvSet(KEY, JSON.stringify(out));
  return out;
}

// The local clock in the schedule's timezone, as "YYYY-MM-DD", "HH:MM" and the weekday number.
function localNow(tz: string, at = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
    .formatToParts(at)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, day: days.indexOf(parts.weekday) };
}

// Sent once per day per schedule. The marker is the record, so a restart mid-day never re-sends.
const sentKey = (id: string, date: string) => `sent:${id}:${date}`;

// The conversation this schedule posts into: its id, or the group whose name matches.
async function findChat(chat: string) {
  const want = chat.toLowerCase();
  const list = await listConversations();
  return (
    list.find((c) => c.id === chat) ??
    list.find((c) => c.channel === "whatsapp" && c.externalId === chat) ??
    list.find((c) => c.channel === "whatsapp" && c.name.toLowerCase() === want) ??
    list.find((c) => c.channel === "whatsapp" && c.name.toLowerCase().includes(want))
  );
}

// Due = enabled, right day, and the clock has reached its time today without it having gone yet.
// Comparing ">=" rather than "==" means a minute missed to a slow tick still sends, a few seconds late.
export async function dueNow(at = Date.now()) {
  const out: Schedule[] = [];
  for (const s of await schedules()) {
    if (!s.enabled || !s.text || !s.chat) continue;
    const now = localNow(s.tz || TZ_DEFAULT, at);
    if (s.days.length && !s.days.includes(now.day)) continue;
    if (now.time < s.time) continue;
    if (await kvGet(sentKey(s.id, now.date))) continue;
    out.push(s);
  }
  return out;
}

// Called once a minute by the worker.
export async function runSchedules(at = Date.now()) {
  const due = await dueNow(at);
  if (!due.length) return { sent: 0 };
  const { sendToConversation } = await import("@/lib/inbound");
  let sent = 0;
  for (const s of due) {
    const now = localNow(s.tz || TZ_DEFAULT, at);
    const conv = await findChat(s.chat);
    if (!conv) {
      await logEvent("schedule-error", { id: s.id, label: s.label, error: `no chat matching "${s.chat}"` });
      continue; // not marked as sent: it will try again next minute, in case the group is still loading
    }
    // Marked before the send, not after: a gateway that answers slowly must never produce two posts.
    await kvSet(sentKey(s.id, now.date), String(at));
    try {
      await sendToConversation(conv.id, s.text, { by: "GAC Desk", quote: false, repeat: true });
      sent++;
      await logEvent("schedule-sent", { id: s.id, label: s.label, chat: s.chat, at: now.time });
    } catch (e) {
      await logEvent("schedule-error", { id: s.id, label: s.label, error: String(e) });
    }
  }
  return { sent };
}

// For the Settings list: what each one will do next, in words.
export async function schedulePreview() {
  const list = await schedules();
  const chats = await listConversations();
  return list.map((s) => {
    const c = chats.find((x) => x.id === s.chat) ?? chats.find((x) => x.name.toLowerCase().includes(s.chat.toLowerCase()));
    return { ...s, chatName: c?.name ?? s.chat, found: !!c };
  });
}

export { findChat };
