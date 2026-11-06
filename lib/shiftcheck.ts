import { kvGet, kvSet, logEvent } from "@/lib/db";
import { readImage } from "@/lib/ai";
import { getMessages, type Conversation } from "@/lib/store";

// Tulaib proves each working day in the "Hubspot Plumbing Time Checking" group with two screenshots:
// the timekeeping timer (clocked in near zero, or clocked out with hours on it) and the sent SOD / EOD
// report email. This reads each picture as it lands and answers in the chat saying which half of the
// day it covers, for which date, and what is still missing.

const DEFAULT_CHATS = ["hubspot plumbing time checking"];

export interface Shift {
  shift: "sod" | "eod" | "unknown";
  date: string | null; // YYYY-MM-DD
  clock: "in" | "out" | null;
  elapsed: string | null; // HH:MM:SS on the timer
  proof: "timer" | "email" | "other";
  detail: string;
}

const PROMPT = `This is a screenshot a developer sent as proof of their working day. Decide what it shows.

Answer with ONLY a JSON object and nothing else, no code fence:
{"shift":"sod"|"eod"|"unknown","date":"YYYY-MM-DD"|null,"clock":"in"|"out"|null,"elapsed":"HH:MM:SS"|null,"proof":"timer"|"email"|"other","detail":"one short line, max 12 words"}

"sod" (start of day) = clocking IN, a timer just started at or near 00:00:00, or a sent email whose subject says "SOD Report".
"eod" (end of day) = clocking OUT, a timer showing hours already worked, or a sent email whose subject says "EOD Report".
"proof" is "timer" for the timekeeping timer page, "email" for a mailbox screenshot, "other" for anything else.
Read the date from whatever is visible: the email subject (a date like 11/03/26 is 3 November 2026), the Windows taskbar clock, or the page itself. Use null if no date is visible.
If the picture is not about starting or ending a shift — a chat, a Slack message, a document — use "unknown" for shift.

Answer with the JSON object only. Never apologise, never explain, never say you cannot see the image.
If you genuinely cannot read it, still answer with JSON: {"shift":"unknown","date":null,"clock":null,"elapsed":null,"proof":"other","detail":"unreadable"}`;

// Which chats this runs in: the group by name, plus anything added for testing. Matched on the
// conversation name or its WhatsApp id/number, so a direct chat can be used to try it out.
export async function shiftCheckChats(): Promise<string[]> {
  try {
    const saved = JSON.parse((await kvGet("shift_check_chats")) ?? "null");
    if (Array.isArray(saved) && saved.length) return saved.map((s: string) => String(s).toLowerCase());
  } catch {
    /* fall back to the default */
  }
  return DEFAULT_CHATS;
}

export async function setShiftCheckChats(list: string[]) {
  const clean = [...new Set(list.map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
  await kvSet("shift_check_chats", JSON.stringify(clean));
  return clean;
}

export function matchesWatch(list: string[], c: { name?: string | null; external_id?: string | null }) {
  const name = String(c.name ?? "").toLowerCase();
  const id = String(c.external_id ?? "").toLowerCase();
  const number = id.replace(/\D/g, "");
  return list.some((w) => name === w || name.includes(w) || id === w || (!!number && w.replace(/\D/g, "") === number));
}

export async function watchesShiftCheck(c: Pick<Conversation, "name" | "external_id">) {
  return matchesWatch(await shiftCheckChats(), c);
}

// The model sometimes answers in prose instead of JSON — "I'm having trouble reading that image" —
// which used to throw and lose the reply for that screenshot entirely. One retry covers it; a second
// prose answer is reported as what it is rather than as a JSON syntax error.
export async function classifyShift(image: Buffer, mime: string): Promise<Shift> {
  let raw = "";
  let parsed: Partial<Shift> | null = null;
  for (let attempt = 0; attempt < 4 && !parsed; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 4000));
    raw = await readImage(image, mime, PROMPT);
    const json = raw.replace(/```json|```/g, "").trim();
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start < 0 || end < start) continue; // no object in there at all: prose, try once more
    try {
      parsed = JSON.parse(json.slice(start, end + 1)) as Partial<Shift>;
    } catch {
      /* half an object: try once more */
    }
  }
  if (!parsed) throw new Error(`The Gemini server did not read the picture. It answered: ${raw.replace(/\s+/g, " ").slice(0, 120)}`);
  return {
    shift: parsed.shift === "sod" || parsed.shift === "eod" ? parsed.shift : "unknown",
    date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
    clock: parsed.clock === "in" || parsed.clock === "out" ? parsed.clock : null,
    elapsed: typeof parsed.elapsed === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(parsed.elapsed) ? parsed.elapsed : null,
    proof: parsed.proof === "timer" || parsed.proof === "email" ? parsed.proof : "other",
    detail: String(parsed.detail ?? "").slice(0, 90),
  };
}

const DAY = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const localDay = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// What has already been confirmed for a date, so the reply can say what is still outstanding. Read back
// out of our own earlier replies in the chat, which keeps the whole feature free of a new table.
const MARK = "🕒";

// What has already been confirmed for a date, read back out of our own earlier replies. A half counts
// as received once either proof for it has arrived — the timer screenshot or the report email — so the
// next line looks forward to the other half of the day instead of nagging for the matching screenshot.
function alreadySeen(texts: string[], date: string) {
  const seen = { sod: false, eod: false };
  for (const t of texts) {
    if (!t.includes(DAY(date))) continue;
    // Only the opening "🕒 SOD …" / "🕒 EOD …" counts — what was actually received. The rest of the
    // line names the other half ("Now waiting on the EOD"), and reading that as proof made one SOD
    // screenshot announce that the whole day was done.
    const m = t.match(/^🕒\s*(SOD|EOD)\b/);
    if (!m) continue;
    if (m[1] === "SOD") seen.sod = true;
    else seen.eod = true;
  }
  return seen;
}

export function shiftMessage(s: Shift, date: string, seen: ReturnType<typeof alreadySeen>) {
  const half = s.shift.toUpperCase();
  const what =
    s.proof === "timer" ? `timer (${s.clock === "out" ? "clocked out" : "clocked in"}${s.elapsed ? ` ${s.elapsed}` : ""})` : s.proof === "email" ? "report email" : "screenshot";
  const sod = seen.sod || s.shift === "sod";
  const eod = seen.eod || s.shift === "eod";
  const lines = [`${MARK} ${half} ${what} received for ${DAY(date)}.`];
  if (sod && eod) lines.push(`SOD and EOD are both done for ${DAY(date)}. Nothing else needed today.`);
  else if (sod) lines.push("Now waiting on the EOD.");
  else lines.push("Now waiting on the SOD.");
  return lines.join(" ");
}

// A read picture is remembered by message id, so pressing Check again costs nothing and the day's
// answer stays the same. Keyed in kv rather than a new column: one row per screenshot, read once.
const seenKey = (messageId: string) => `shift:${messageId}`;

async function shiftFor(messageId: string, image: Buffer, mime: string): Promise<Shift> {
  const cached = await kvGet(seenKey(messageId));
  if (cached) {
    try {
      return JSON.parse(cached) as Shift;
    } catch {
      /* re-read it below */
    }
  }
  const s = await classifyShift(image, mime);
  await kvSet(seenKey(messageId), JSON.stringify(s));
  return s;
}

export interface DayCheck {
  date: string;
  sod: { timer: Shift | null; email: Shift | null };
  eod: { timer: Shift | null; email: Shift | null };
}

// Goes back over the pictures of the last `hours` and says what is there and what is missing. This is
// the manual check: it reports to the dashboard and posts nothing into the chat.
export async function checkRecent(conv: Conversation, hours = 24) {
  const { downloadStoredMedia } = await import("@/lib/whatsapp");
  const since = Date.now() - hours * 3600_000;
  // Any picture counts, whoever posted it: in a watched chat a teammate's screenshot is filed as ours
  const msgs = (await getMessages(conv.id)).filter((m) => m.kind === "image" && Number(m.created_at) >= since && m.external_id);
  const days = new Map<string, DayCheck>();
  let read = 0;
  let unreadable = 0;
  let ignored = 0;
  for (const m of msgs) {
    let buf: Buffer | null = null;
    let mime = m.media_mime ?? "image/jpeg";
    try {
      const got = await downloadStoredMedia(conv.account, conv.external_id, String(m.external_id));
      if (got) {
        buf = got.buf;
        mime = got.mime;
      }
    } catch {
      /* the gateway may no longer hold it */
    }
    if (!buf) {
      unreadable++;
      continue;
    }
    let s: Shift;
    try {
      s = await shiftFor(m.id, buf, mime);
    } catch {
      unreadable++;
      continue;
    }
    read++;
    if (s.shift === "unknown") {
      ignored++;
      continue;
    }
    const date = s.date ?? localDay(Number(m.created_at));
    const day = days.get(date) ?? { date, sod: { timer: null, email: null }, eod: { timer: null, email: null } };
    const half = day[s.shift];
    if (s.proof === "timer") half.timer = s;
    else if (s.proof === "email") half.email = s;
    days.set(date, day);
  }
  const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { hours, pictures: msgs.length, read, unreadable, ignored, days: list, summary: summarise(list, hours) };
}

function summarise(days: DayCheck[], hours: number) {
  if (!days.length) return `No SOD or EOD screenshots in the last ${hours} hours.`;
  return days
    .map((d) => {
      // Either proof counts as that half received, the same rule the chat replies use.
      const part = (half: DayCheck["sod"], label: string) => {
        const have = [half.timer && "timer", half.email && "report email"].filter(Boolean);
        return have.length ? `${label} ✓ (${have.join(" + ")})` : `${label} missing`;
      };
      return `${DAY(d.date)}: ${part(d.sod, "SOD")}, ${part(d.eod, "EOD")}.`;
    })
    .join(" ");
}

// Several screenshots usually arrive together. They are handled strictly one after another per chat:
// run in parallel they all read the same "nothing confirmed yet" state, compose the same sentence and
// collide in the send lock, which is exactly what happened the first time this ran.
const queues = new Map<string, Promise<unknown>>();
function queued<T>(convId: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(convId) ?? Promise.resolve()).then(job, job);
  queues.set(
    convId,
    next.catch(() => {}).finally(() => {
      if (queues.get(convId) === next) queues.delete(convId);
    }),
  );
  return next;
}

// The gateway answers 502 while it is reconnecting. The reply is worth a couple of retries before
// it is given up on, otherwise a blip loses the confirmation for that screenshot entirely.
async function sendWithRetry(convId: string, text: string) {
  const { sendToConversation } = await import("@/lib/inbound");
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 4000));
    try {
      return await sendToConversation(convId, text, { by: "GAC Desk", quote: false, repeat: true });
    } catch (e) {
      last = e;
      if (!/502|503|504|timeout|already being sent|ECONNRESET|fetch failed/i.test(String(e))) throw e;
    }
  }
  throw last;
}

// Reads one incoming picture and, when it is shift proof, answers in the same chat. Anything else —
// a Slack screenshot, a document — is left alone, so the chat only hears from us when it matters.
export function checkShiftImage(conv: Conversation, messageId: string, image: Buffer, mime: string, at: number) {
  return queued(conv.id, () => runShiftCheck(conv, messageId, image, mime, at));
}

// How long to keep trying when the server itself is having a bad moment. The end-of-day proof can
// land at 1 am or 3 am and still has to be answered, so a failure waits and goes again rather than
// being dropped until someone presses Check in the morning.
const LATER = [60_000, 5 * 60_000, 15 * 60_000];

async function runShiftCheck(conv: Conversation, messageId: string, image: Buffer, mime: string, at: number, round = 0): Promise<{ checked: boolean; error?: string; shift?: Shift; replied?: string | false }> {
  let s: Shift;
  try {
    s = await shiftFor(messageId, image, mime);
  } catch (e) {
    const wait = LATER[round];
    await logEvent("shift-check-error", { conv: conv.id, message: messageId, error: String(e), retryIn: wait ? `${wait / 60000}m` : "giving up" });
    if (!wait) return { checked: false, error: String(e) };
    setTimeout(() => void queued(conv.id, () => runShiftCheck(conv, messageId, image, mime, at, round + 1)), wait);
    return { checked: false, error: String(e) };
  }
  if (s.shift === "unknown") {
    await logEvent("shift-check", { conv: conv.id, message: messageId, shift: "unknown", detail: s.detail });
    return { checked: true, shift: s, replied: false as const };
  }
  const date = s.date ?? localDay(at);
  const mine = (await getMessages(conv.id)).filter((m) => m.direction === "out" && m.text?.includes(MARK)).map((m) => String(m.text));
  const text = shiftMessage(s, date, alreadySeen(mine, date));
  await sendWithRetry(conv.id, text);
  await logEvent("shift-check", { conv: conv.id, message: messageId, shift: s.shift, date, proof: s.proof, replied: text });
  return { checked: true, shift: s, replied: text };
}
