import { all, logEvent } from "@/lib/db";
import { aiConfigured, suggestReply } from "@/lib/ai";
import { aiHoursLabel, aiHoursNow } from "@/lib/aihours";
import {
  accountForSession,
  bareId,
  chatStatuses,
  downloadMedia,
  isNewer,
  parseAck,
  parseIncoming,
  resolveMentions,
  senderPhone,
  sendWhatsApp,
  taggablePeople,
  waAccounts,
  waConfigured,
  type Delivery,
  type Incoming,
} from "@/lib/whatsapp";
import { teamMember } from "@/lib/team-numbers";
import { pollAll, sendEmail } from "@/lib/email";
import { defaultSender, getAccount, listAccounts } from "@/lib/accounts";
import { trackGroup, trackedGroups } from "@/lib/groups";
import { addMessage, findOrCreateConversation, getConversation, getMessages, listConversations, updateConversation, updateMessage, type Conversation, type ConvSummary } from "@/lib/store";

const log = (source: string, payload: unknown) => logEvent(source, payload).catch(() => {});

// ---------- Suggested replies ----------

const timers = new Map<string, NodeJS.Timeout>();

// Clients often send several messages in a row, so wait a few seconds before drafting a reply.
// Office hours only: overnight the message is still stored and still shows as waiting, it just does
// not spend a Gemini call on a draft nobody will read until morning. "Suggest a reply" still works.
export function afterIncoming(convId: string) {
  if (!aiConfigured()) return;
  if (!aiHoursNow()) return;
  clearTimeout(timers.get(convId));
  timers.set(
    convId,
    setTimeout(() => {
      timers.delete(convId);
      suggestReply(convId, true).catch((e) => log("suggest-error", { convId, error: String(e) }));
    }, 4000),
  );
}

// ---------- WhatsApp ----------

// A teammate answered in a client chat. The thread summary used to be rebuilt here, every time,
// all day — in a busy group that is dozens of Gemini calls for a summary nobody opened. It is
// written on demand now: the Context button in the inbox calls it when you actually want it.
export function afterTeammateReply(_convId: string) {
  /* nothing automatic: see the Context button in the inbox */
}

// Delivery ticks for a message we sent (matched by its WhatsApp id in any form)
export async function applyDelivery(id: string, status: Delivery, convId?: string) {
  const bare = bareId(id);
  if (!bare) return 0;
  const rows = await all<{ id: string; status: string | null }>(
    `select id, status from messages where direction = 'out' and (external_id = ? or external_id = ? or external_id like ?)${convId ? " and conv_id = ?" : ""}`,
    id, bare, `%_${bare}`, ...(convId ? [convId] : []),
  );
  let n = 0;
  for (const r of rows) if (isNewer(r.status, status)) (await updateMessage(r.id, { status }), n++);
  return n;
}

// Fallback for missed ack events: re-read the status of our recent WhatsApp messages from the gateway
export async function syncDelivery() {
  const convs = await all<{ id: string; external_id: string; account: string }>(
    `select distinct c.id, c.external_id, c.account from conversations c join messages m on m.conv_id = c.id
     where c.channel = 'whatsapp' and m.direction = 'out' and m.status in ('sent', 'delivered') and m.created_at > ? limit 30`,
    Date.now() - 2 * 86_400_000,
  );
  const { waAccounts } = await import("@/lib/whatsapp");
  const accs = await waAccounts();
  for (const c of convs) {
    const a = accs.find((x) => x.id === c.account) ?? accs[0];
    if (!a) continue;
    const chatId = c.external_id.includes("@") ? c.external_id : `${c.external_id}@c.us`;
    for (const s of await chatStatuses(a, chatId).catch(() => [])) if (["delivered", "read", "failed"].includes(s.status)) await applyDelivery(s.id, s.status as Delivery, c.id);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleWhatsApp(body: any) {
  const ack = parseAck(body);
  if (ack) return { delivery: ack.status, updated: await applyDelivery(ack.id, ack.status) };
  log("whatsapp", body);
  const inc = parseIncoming(body);
  if (!inc) return { ignored: true };
  return storeWhatsApp(inc, true);
}

// Stores one WhatsApp message. live=false is the history import: no AI drafts, no voice downloads.
export async function storeWhatsApp(inc: Incoming, live: boolean) {
  // Which of our WhatsApp numbers this happened on
  const acc = await accountForSession(inc.sessionId);
  const account = acc?.id ?? "";
  // Who wrote it: you, someone on our side (team numbers in Settings), or the client
  const fromPhone = inc.fromMe ? "" : await senderPhone(acc, inc.senderId);
  const teammate = inc.fromMe ? null : await teamMember(fromPhone);
  const ours = inc.fromMe || !!teammate;
  // Group members without a WhatsApp name show as their number, never as a raw id
  if (!inc.author || /@(c\.us|lid)$/.test(inc.author)) inc.author = fromPhone ? `+${fromPhone}` : "";

  // Group chats: only the ones you've messaged (or added in Settings, or imported) come into the inbox
  if (inc.isGroup) {
    const groups = await trackedGroups();
    if (!groups[inc.chatId]) return { ignored: "untracked group" };
    const conv = await findOrCreateConversation({ channel: "whatsapp", externalId: inc.chatId, account, name: groups[inc.chatId] });
    const text = inc.fromMe ? inc.text : `${teammate ?? inc.author}${teammate || inc.author ? ": " : ""}${inc.text}`;
    if (inc.fromMe) {
      const recent = (await getMessages(conv.id)).slice(-3);
      if (recent.some((m) => m.direction === "out" && m.text === inc.text && Math.abs(Number(m.created_at) - inc.at) < 120_000)) return { duplicate: true };
    }
    const id = await addMessage({
      conv_id: conv.id,
      direction: ours ? "out" : "in",
      kind: inc.kind,
      text: text || null,
      external_id: inc.id,
      sent_by: inc.fromMe ? "phone" : teammate,
      status: ours ? "sent" : null,
      created_at: inc.at,
      via: acc?.label,
    });
    if (id && ours && live) await updateConversation(conv.id, { suggestion: null, suggestion_for: null, reminded_at: null });
    if (id && live) {
      // A watched chat exists for the shift screenshots, so whoever posts one gets it checked —
      // teammates and your own phone included, whose messages are otherwise filed as ours.
      shiftCheck(conv, id, inc);
      if (teammate) afterTeammateReply(conv.id);
      else if (!ours) afterIncoming(conv.id);
    }
    return { stored: id, group: true, by: teammate ?? (inc.fromMe ? "you" : "client") };
  }

  if (inc.fromMe) {
    // You replied from your phone (or the dashboard's own send echoed back): record it once
    const conv = await findOrCreateConversation({ channel: "whatsapp", externalId: inc.phone, account, name: inc.phone });
    const recent = (await getMessages(conv.id)).slice(-3);
    if (recent.some((m) => m.direction === "out" && m.text === inc.text && Math.abs(Number(m.created_at) - inc.at) < 120_000)) return { duplicate: true };
    const id = await addMessage({ conv_id: conv.id, direction: "out", kind: inc.kind, text: inc.text || null, external_id: inc.id, sent_by: "phone", status: "sent", created_at: inc.at, via: acc?.label });
    if (id && live) await updateConversation(conv.id, { suggestion: null, suggestion_for: null });
    if (id && live) shiftCheck(conv, id, inc); // a screenshot you posted yourself in a watched chat counts too
    return { recorded: "outgoing", stored: id };
  }

  // A direct chat with a teammate is internal: shown in the inbox, never counted as a waiting client
  const conv = await findOrCreateConversation({ channel: "whatsapp", externalId: inc.phone, account, name: teammate ?? inc.name });
  if (teammate && !conv.internal) await updateConversation(conv.id, { internal: 1 });
  const id = await addMessage({ conv_id: conv.id, direction: "in", kind: inc.kind, text: inc.kind === "voice" ? null : inc.text || null, external_id: inc.id, created_at: inc.at, via: acc?.label });
  if (!id) return { duplicate: true };
  if (!live) return { stored: id };
  // A teammate's direct chat is otherwise left alone, but a shift screenshot in a watched one still counts
  if (teammate) {
    shiftCheck(conv, id, inc);
    return { stored: id };
  }

  if (inc.kind === "voice") {
    // Keep the audio so it can be played in the thread, but don't transcribe: that happens only when
    // you press Transcribe on the voice note, so a day of voice notes costs the server nothing.
    (async () => {
      try {
        const audio = await downloadMedia(inc);
        if (audio) await updateMessage(id, { media_path: audio.file, media_mime: audio.mime });
      } catch (e) {
        log("voice-error", { id, error: String(e) });
      }
      afterIncoming(conv.id);
    })();
  } else {
    shiftCheck(conv, id, inc);
    afterIncoming(conv.id);
  }

  return { stored: id };
}

// A picture in a watched chat is read as shift proof (SOD / EOD) and answered there. Runs in the
// background so the webhook still returns at once, and stays quiet unless the picture really is proof.
function shiftCheck(conv: Conversation, messageId: string, inc: Incoming) {
  if (inc.kind !== "image") return;
  (async () => {
    try {
      const { watchesShiftCheck, checkShiftImage } = await import("@/lib/shiftcheck");
      if (!(await watchesShiftCheck(conv))) return;
      const img = await downloadMedia(inc);
      if (!img) return log("shift-check-error", { message: messageId, error: "the gateway had no picture" });
      await updateMessage(messageId, { media_path: img.file, media_mime: img.mime });
      await checkShiftImage(conv, messageId, img.buf, img.mime, inc.at);
    } catch (e) {
      log("shift-check-error", { message: messageId, error: String(e) });
    }
  })();
}

// ---------- Sending ----------

// opts.from = the account (mailbox / WhatsApp number) to send from; defaults to the one the client wrote to.
// "@Name" → a real WhatsApp mention of a saved contact or team number (in a group: only its members).
// Only messages that tag someone wait for the contact and member lists (both are usually cached already).
// A group member's plain name is tagged too, but only from lists already loaded: a message without "@" never waits.
async function mentionsFor(text: string, c: { external_id: string }, accountId: string, waitMs = 40_000) {
  const none = { text, display: text, mentions: [] as string[], missed: [] as string[], tagged: [] as string[] };
  const at = /@\p{L}/u.test(text);
  if (!at && !c.external_id.endsWith("@g.us")) return none;
  const accs = await waAccounts();
  const a = accs.find((x) => x.id === accountId) ?? accs[0];
  if (!a) return none;
  const { people, close } = await taggablePeople(a, c.external_id, at ? waitMs : 0);
  return resolveMentions(text, people, close ?? []);
}

// What Send would do with this text: who gets tagged, which "@Name"s match nobody, and the group's members
// (first names) for the "@" picker in the reply box.
export async function previewTags(convId: string, text: string) {
  const c = await getConversation(convId);
  if (!c || c.channel !== "whatsapp") return { tagged: [], missed: [], members: [] };
  const a = await defaultSender("whatsapp", c.account);
  if (!a) return { tagged: [], missed: [], members: [] };
  const { close } = await taggablePeople(a, c.external_id, 3_000);
  const m = text.trim() ? await mentionsFor(text, c, a.id, 3_000) : { tagged: [] as string[], missed: [] as string[] };
  const members = [...new Set((close ?? []).map((p) => p.name.split(/\s+/)[0]).filter((n) => n.length >= 3 && /^\p{L}/u.test(n)))].sort();
  return { tagged: m.tagged, missed: m.missed, members: c.external_id.endsWith("@g.us") ? members : [] };
}

// Load a group's members and the contact list ahead of time, so tagging in it doesn't wait at send time
export async function warmTagging(convId: string) {
  const c = await getConversation(convId);
  if (!c || c.channel !== "whatsapp") return;
  const a = await defaultSender("whatsapp", c.account);
  if (a) taggablePeople(a, c.external_id).catch(() => {});
}

// Same text to the same chat while a send is running or within a minute = a double click, not a new message
const inFlight = new Set<string>();

export async function sendToConversation(
  convId: string,
  text: string,
  // repeat: this is an automatic answer to something that really happened twice (two screenshots of the
  // same proof), not a double click, so saying the same thing again is correct.
  opts: { ack?: boolean; by?: string; from?: string | null; quote?: boolean; repeat?: boolean } = {},
) {
  // "@tulaib" is stored as "@923…", so compare with mentions blanked out
  const norm = (s: string | null | undefined) => String(s ?? "").replace(/@\S+/g, "@").replace(/\s+/g, " ").trim();
  const key = `${convId}\n${norm(text)}`;
  if (!opts.repeat) {
    if (inFlight.has(key)) throw new Error("This message is already being sent.");
    const recent = (await getMessages(convId)).slice(-5);
    if (recent.some((m) => m.direction === "out" && norm(m.text) === norm(text) && Date.now() - Number(m.created_at) < 60_000))
      throw new Error("You sent this exact message less than a minute ago.");
  }
  inFlight.add(key);
  try {
    return await sendOnceTo(convId, text, opts);
  } finally {
    inFlight.delete(key);
  }
}

async function sendOnceTo(convId: string, text: string, opts: { ack?: boolean; by?: string; from?: string | null; quote?: boolean }) {
  const c = await getConversation(convId);
  if (!c) throw new Error("Conversation not found");
  let r: { ok: boolean; simulated?: boolean; id?: string; error?: string };
  let via: string | null = null;
  let untagged: string[] = [];
  if (c.demo) r = { ok: true, simulated: true };
  else if (c.channel === "whatsapp" || c.channel === "email") {
    const kind = c.channel;
    const sender = (opts.from ? await getAccount(opts.from) : null) ?? (await defaultSender(kind, c.account));
    if (!sender) throw new Error(`No ${kind === "email" ? "mailbox" : "WhatsApp number"} is set up for sending. Add one in Settings.`);
    via = kind === "email" ? sender.address : sender.label;
    if (kind === "email") r = await sendEmail(sender.id, c.external_id, c.subject, text);
    else {
      // WhatsApp: turn "@Name" into real mentions. Messages go out plain, not as a reply to the
      // client's last message: the gateway takes ~25 s to accept a quoted send against ~1 s for a
      // plain one, and that wait was felt on every reply. Quoting is opt-in now (quote: true).
      const msgs = await getMessages(convId);
      const lastIn = opts.quote ? [...msgs].reverse().find((m) => m.direction === "in" && m.external_id) : undefined;
      const m = await mentionsFor(text, c, sender.id);
      untagged = m.missed;
      r = await sendWhatsApp(c.external_id, m.text, sender.id, { quotedMessageId: lastIn?.external_id, mentions: m.mentions });
      text = m.display; // stored and shown as "@Tulaib", not "@923…"
    }
  } else if (c.channel === "clickup") {
    // A reply in a task's thread is posted as a ClickUp comment, with a notification for the team
    const { postComment } = await import("@/lib/clickup");
    const p = await postComment(c.external_id, text, true);
    r = { ok: true, id: p?.id ? `cu_${p.id}` : undefined };
    via = "ClickUp";
  } else r = { ok: true, simulated: true }; // Slack / Teams / Outlook connect later
  if (!r.ok) throw new Error(r.error ?? "Send failed");
  await addMessage({ conv_id: convId, direction: "out", text, ack: opts.ack ? 1 : 0, sent_by: opts.by ?? "me", status: r.simulated ? "simulated" : "sent", external_id: r.id ?? null, via });
  await updateConversation(convId, { suggestion: null, suggestion_for: null, reminded_at: null });
  return { simulated: !!r.simulated, channel: c.channel, name: c.name, via, untagged };
}

// Send to anyone: a WhatsApp group or contact picked from your lists, or any email address.
// The conversation is created (or reused) so replies land in the same thread.
export async function sendToTarget(t: { channel: "whatsapp" | "email"; from: string; to: string; toName?: string; subject?: string; text: string; by?: string }) {
  const sender = await getAccount(t.from);
  if (!sender || sender.kind !== t.channel) throw new Error("Pick which account to send from");
  let externalId: string;
  let account: string;
  if (t.channel === "whatsapp") {
    // People are keyed by phone number, groups by group id (same as incoming messages)
    externalId = t.to.endsWith("@g.us") ? t.to : t.to.split("@")[0].replace(/[^\d]/g, "");
    account = sender.id;
    if (t.to.endsWith("@g.us")) await trackGroup(t.to, t.toName || "WhatsApp group");
  } else {
    externalId = t.to.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(externalId)) throw new Error("That email address doesn't look right");
    account = sender.address;
  }
  const conv = await findOrCreateConversation({ channel: t.channel, externalId, account, name: t.toName || externalId, subject: t.subject });
  if (t.subject) await updateConversation(conv.id, { subject: t.subject });
  const r = await sendToConversation(conv.id, t.text, { from: sender.id, by: t.by });
  return { ...r, convId: conv.id };
}

// ---------- Background worker ----------

// New email → WhatsApp alert to you straight away (WhatsApp messages you already see on your phone).
async function alertNewEmail(convId: string) {
  const to = process.env.REMINDER_WHATSAPP_TO;
  const c = await getConversation(convId);
  if (!to || !c || c.demo || !(await waConfigured())) return;
  const last = (await getMessages(convId)).filter((m) => m.direction === "in").pop();
  const url = process.env.PUBLIC_URL ? `\nOpen: ${process.env.PUBLIC_URL}/inbox?c=${convId}` : "";
  await sendWhatsApp(to, `📧 New email to ${c.account} from *${c.name}*\n${c.subject ? `Subject: ${c.subject}\n` : ""}${(last?.text ?? "").slice(0, 300)}${url}`);
}

let polling = false;
async function pollEmail() {
  if (polling) return;
  polling = true;
  try {
    await pollAll((convId) => {
      afterIncoming(convId);
      alertNewEmail(convId).catch((e) => log("alert-error", String(e)));
    });
  } catch (e) {
    log("poll-error", String(e));
  } finally {
    polling = false;
  }
}

// Sends you a summary of clients still waiting, with the suggested reply for each: on WhatsApp
// (REMINDER_WHATSAPP_TO) and/or by email (REMINDER_EMAIL_TO, sent from the first working mailbox).
// Each client can have its own "remind after" time; otherwise REMINDER_AFTER_MINUTES applies.
async function sendReminders() {
  // The summary on WhatsApp was noise on the phone, so it only goes there with REMINDER_WHATSAPP_DIGEST=on.
  // The number stays set: new-email alerts still reach it, and the summary still goes out by email.
  const waTo = process.env.REMINDER_WHATSAPP_DIGEST === "on" ? process.env.REMINDER_WHATSAPP_TO : null;
  const mailTo = process.env.REMINDER_EMAIL_TO;
  const useWa = !!waTo && (await waConfigured());
  const mailFrom = mailTo ? await reminderMailbox() : null;
  if (!useWa && !mailFrom) return;
  const every = Number(process.env.REMINDER_MINUTES ?? 10) * 60_000;
  const defaultAfter = Number(process.env.REMINDER_AFTER_MINUTES ?? 5);
  const now = Date.now();
  const due: ConvSummary[] = [];
  for (const c of await listConversations()) {
    // Task comments live in the inbox too, but they're our own team: no client reminders for them
    if (!c.waiting || c.demo || c.channel === "clickup" || !c.waitingSince || now - c.waitingSince < (c.remindAfter ?? defaultAfter) * 60_000) continue;
    const conv = await getConversation(c.id);
    if (!conv?.reminded_at || now - Number(conv.reminded_at) > every) due.push(c);
  }
  if (!due.length) return;
  const title = `${due.length} client${due.length > 1 ? "s" : ""} waiting for your reply`;
  const url = process.env.PUBLIC_URL;
  let ok = false;
  const kind = (c: (typeof due)[number]) => (c.channel === "whatsapp" && c.externalId.endsWith("@g.us") ? "client group" : c.channel);
  const more = due.length > 15 ? `\n\n…and ${due.length - 15} more` : "";
  if (useWa) {
    const lines = due.slice(0, 15).map((c) => {
      const mins = Math.round((now - (c.waitingSince ?? now)) / 60000);
      return `• *${c.name}* (${kind(c)}, no reply from our side for ${mins}m)\n  "${(c.last?.text ?? "").slice(0, 90)}"${c.suggestion ? `\n  Suggested: ${c.suggestion}` : ""}`;
    });
    ok = (await sendWhatsApp(waTo!, `⏰ ${title}\n\n${lines.join("\n\n")}${more}${url ? `\n\nOpen: ${url}` : ""}`)).ok || ok;
  }
  if (mailFrom) {
    const lines = due.slice(0, 15).map((c) => {
      const mins = Math.round((now - (c.waitingSince ?? now)) / 60000);
      return `${c.name} (${kind(c)}, no reply from our side for ${mins} min)\n  "${(c.last?.text ?? "").slice(0, 200)}"${c.suggestion ? `\n  Suggested reply: ${c.suggestion}` : ""}${url ? `\n  Open: ${url}/inbox?c=${c.id}` : ""}`;
    });
    const r = await sendEmail(mailFrom, mailTo!, `GAC Desk: ${title}`, `${title}\n\n${lines.join("\n\n")}${more}`, false).catch((e) => ({ ok: false, error: String(e) }));
    if (!r.ok) log("reminder-email-error", r);
    ok = r.ok || ok;
  }
  if (ok) for (const c of due) await updateConversation(c.id, { reminded_at: now });
}

// The first enabled mailbox whose last check passed (falls back to any enabled one)
async function reminderMailbox() {
  const boxes = (await listAccounts()).filter((a) => a.kind === "email" && a.enabled && a.canSend);
  return (boxes.find((a) => a.status?.ok) ?? boxes[0])?.id ?? null;
}

export function startWorker() {
  const g = globalThis as unknown as { __gacWorker?: boolean };
  if (g.__gacWorker) return;
  g.__gacWorker = true;

  // Mailboxes can be added any time in Settings, so always keep checking
  setTimeout(pollEmail, 5_000);
  setInterval(pollEmail, 60_000);
  setInterval(() => sendReminders().catch((e) => log("reminder-error", String(e))), 60_000);

  // Check every connection shortly after start, then every HEALTH_MINUTES (default 10)
  const health = () => import("@/lib/health").then((h) => h.runHealth()).catch((e) => log("health-error", String(e)));
  setTimeout(health, 20_000);
  setInterval(health, Number(process.env.HEALTH_MINUTES ?? 10) * 60_000);

  // Import earlier WhatsApp messages on start and whenever a session comes back to "ready"
  // (gateway restart, QR re-link), so nothing sent while we weren't listening is missed.
  const ready = new Map<string, boolean>();
  const watchSessions = async () => {
    const { sessionStatus, waAccounts } = await import("@/lib/whatsapp");
    let trigger = false;
    for (const a of await waAccounts()) {
      const now = (await sessionStatus(a)).status === "ready";
      if (now && !ready.get(a.id)) trigger = true;
      ready.set(a.id, now);
    }
    if (trigger && process.env.BACKFILL_DAYS !== "0") {
      const r = await (await import("@/lib/backfill")).backfillWhatsApp();
      log("backfill-done", r);
    }
  };
  setTimeout(() => watchSessions().catch((e) => log("backfill-error", String(e))), 30_000);
  setInterval(() => syncDelivery().catch((e) => log("delivery-error", String(e))), 120_000);

  // Timers follow ClickUp statuses (in progress / revision = running), checked every 2 minutes on top of the
  // webhook; open tasks without an estimate get Gemini's (strict) projection every 10 minutes.
  const statusTimers = async () => {
    const { board } = await import("@/lib/clickup");
    const b = await board();
    if (b.source !== "clickup" || b.error) return;
    const r = await (await import("@/lib/timers")).syncStatusTimers(b.tasks);
    if (r.started || r.stopped) log("status-timers", r);
  };
  setTimeout(() => statusTimers().catch((e) => log("status-timer-error", String(e))), 25_000);
  setInterval(() => statusTimers().catch((e) => log("status-timer-error", String(e))), 120_000);
  // Shift hours: clocks stop at the end of the shift and resume at the next start (checked every minute)
  const shift = async () => {
    const r = await (await import("@/lib/timers")).shiftTick();
    if (r) log("shift", r);
  };
  setInterval(() => shift().catch((e) => log("shift-error", String(e))), 60_000);
  // ClickUp comments in the inbox: the webhook brings new ones in straight away. This picks up anything
  // it missed and, a few tasks at a time, reads the comments on tasks the inbox hasn't seen yet.
  const taskChats = async () => {
    const { syncRecentTaskChats, syncTaskComments } = await import("@/lib/taskchat");
    const got = await syncRecentTaskChats(6);
    const { board } = await import("@/lib/clickup");
    const b = await board();
    if (b.source === "clickup" && !b.error) {
      const { kvGet, kvSet } = await import("@/lib/db");
      const done = new Set(JSON.parse((await kvGet("task_chat_scanned")) ?? "[]") as string[]);
      // A few at a time, and the board already tells us the title and project (one call per task, not two)
      const next = b.tasks.filter((t) => !done.has(t.id)).slice(0, 6);
      for (const t of next) {
        await syncTaskComments(t.id, { title: t.title, project: t.project, url: t.url ?? "" }).catch(() => {});
        done.add(t.id);
      }
      if (next.length) await kvSet("task_chat_scanned", JSON.stringify([...done].slice(-2000)));
    }
    if (got) log("task-comments", { incoming: got });
  };
  setTimeout(() => taskChats().catch((e) => log("task-chat-error", String(e))), 45_000);
  setInterval(() => taskChats().catch((e) => log("task-chat-error", String(e))), 3 * 60_000);

  const estimates = async () => {
    if (!aiHoursNow()) return; // office hours only: AI estimates are not worth waking up for
    const r = await (await import("@/lib/estimates")).estimateMissing();
    if (r.estimated) log("estimates", r);
  };
  setTimeout(() => estimates().catch((e) => log("estimate-error", String(e))), 60_000);
  setInterval(() => estimates().catch((e) => log("estimate-error", String(e))), 10 * 60_000);
  setInterval(() => watchSessions().catch((e) => log("backfill-error", String(e))), 120_000);

  log("ai-hours", { background: aiHoursLabel(), now: aiHoursNow() ? "on" : "off" });

  // Scheduled group messages (Settings → Scheduled messages). Checked every minute; each one goes
  // once a day, marked in kv, so a restart at noon never re-sends the 11 am one.
  const scheduled = async () => {
    const r = await (await import("@/lib/schedules")).runSchedules();
    if (r.sent) log("schedules", r);
  };
  setInterval(() => scheduled().catch((e) => log("schedule-error", String(e))), 60_000);

  // After a restart, draft replies for anyone still waiting without one (office hours only, and a
  // restart at 3 am used to redraft the whole backlog in one go)
  setTimeout(async () => {
    if (!aiHoursNow()) return;
    try {
      for (const c of await listConversations()) if (c.waiting && !c.demo && !c.suggestion) afterIncoming(c.id);
    } catch (e) {
      log("startup-error", String(e));
    }
  }, 8_000);
}
