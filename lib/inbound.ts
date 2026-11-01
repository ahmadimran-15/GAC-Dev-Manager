import { logEvent } from "@/lib/db";
import { aiConfigured, suggestReply, transcribe, transcriptionConfigured } from "@/lib/ai";
import { accountForSession, downloadMedia, parseIncoming, sendWhatsApp, waConfigured } from "@/lib/whatsapp";
import { pollAll, sendEmail } from "@/lib/email";
import { defaultSender, getAccount, listAccounts } from "@/lib/accounts";
import { trackGroup, trackedGroups } from "@/lib/groups";
import { addMessage, findOrCreateConversation, getConversation, getMessages, listConversations, updateConversation, updateMessage } from "@/lib/store";

const log = (source: string, payload: unknown) => logEvent(source, payload).catch(() => {});

// ---------- Suggested replies ----------

const timers = new Map<string, NodeJS.Timeout>();

// Clients often send several messages in a row, so wait a few seconds before drafting a reply.
export function afterIncoming(convId: string) {
  if (!aiConfigured()) return;
  clearTimeout(timers.get(convId));
  timers.set(
    convId,
    setTimeout(() => {
      timers.delete(convId);
      suggestReply(convId).catch((e) => log("suggest-error", { convId, error: String(e) }));
    }, 4000),
  );
}

// ---------- WhatsApp ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleWhatsApp(body: any) {
  log("whatsapp", body);
  const inc = parseIncoming(body);
  if (!inc) return { ignored: true };

  // Which of our WhatsApp numbers this happened on
  const acc = await accountForSession(inc.sessionId);
  const account = acc?.id ?? "";

  // Group chats: only the ones you've messaged (or added in Settings) come into the inbox
  if (inc.isGroup) {
    const groups = await trackedGroups();
    if (!groups[inc.chatId]) return { ignored: "untracked group" };
    const conv = await findOrCreateConversation({ channel: "whatsapp", externalId: inc.chatId, account, name: groups[inc.chatId] });
    const text = inc.fromMe ? inc.text : `${inc.author ? `${inc.author}: ` : ""}${inc.text}`;
    if (inc.fromMe) {
      const recent = (await getMessages(conv.id)).slice(-3);
      if (recent.some((m) => m.direction === "out" && m.text === inc.text && Math.abs(Number(m.created_at) - inc.at) < 120_000)) return { duplicate: true };
    }
    const id = await addMessage({ conv_id: conv.id, direction: inc.fromMe ? "out" : "in", kind: inc.kind, text: text || null, external_id: inc.id, sent_by: inc.fromMe ? "phone" : null, created_at: inc.at, via: acc?.label });
    if (id && !inc.fromMe) afterIncoming(conv.id);
    return { stored: id, group: true };
  }

  if (inc.fromMe) {
    // You replied from your phone (or the dashboard's own send echoed back): record it once
    const conv = await findOrCreateConversation({ channel: "whatsapp", externalId: inc.phone, account, name: inc.phone });
    const recent = (await getMessages(conv.id)).slice(-3);
    if (recent.some((m) => m.direction === "out" && m.text === inc.text && Math.abs(Number(m.created_at) - inc.at) < 120_000)) return { duplicate: true };
    await addMessage({ conv_id: conv.id, direction: "out", text: inc.text, external_id: inc.id, sent_by: "phone", status: "sent", created_at: inc.at, via: acc?.label });
    await updateConversation(conv.id, { suggestion: null, suggestion_for: null });
    return { recorded: "outgoing" };
  }

  const conv = await findOrCreateConversation({ channel: "whatsapp", externalId: inc.phone, account, name: inc.name });
  const id = await addMessage({ conv_id: conv.id, direction: "in", kind: inc.kind, text: inc.kind === "voice" ? null : inc.text || null, external_id: inc.id, created_at: inc.at, via: acc?.label });
  if (!id) return { duplicate: true };

  if (inc.kind === "voice") {
    // Download and transcribe in the background; the webhook must answer quickly
    (async () => {
      try {
        const audio = await downloadMedia(inc);
        if (audio) {
          await updateMessage(id, { media_path: audio.file, media_mime: audio.mime });
          if (transcriptionConfigured()) await updateMessage(id, { transcript: await transcribe(audio.buf, audio.mime) });
        }
      } catch (e) {
        log("voice-error", { id, error: String(e) });
      }
      afterIncoming(conv.id);
    })();
  } else afterIncoming(conv.id);

  return { stored: id };
}

// ---------- Sending ----------

// opts.from = the account (mailbox / WhatsApp number) to send from; defaults to the one the client wrote to.
export async function sendToConversation(convId: string, text: string, opts: { ack?: boolean; by?: string; from?: string | null } = {}) {
  const c = await getConversation(convId);
  if (!c) throw new Error("Conversation not found");
  let r: { ok: boolean; simulated?: boolean; id?: string; error?: string };
  let via: string | null = null;
  if (c.demo) r = { ok: true, simulated: true };
  else if (c.channel === "whatsapp" || c.channel === "email") {
    const kind = c.channel;
    const sender = (opts.from ? await getAccount(opts.from) : null) ?? (await defaultSender(kind, c.account));
    if (!sender) throw new Error(`No ${kind === "email" ? "mailbox" : "WhatsApp number"} is set up for sending. Add one in Settings.`);
    via = kind === "email" ? sender.address : sender.label;
    r = kind === "email" ? await sendEmail(sender.id, c.external_id, c.subject, text) : await sendWhatsApp(c.external_id, text, sender.id);
  } else r = { ok: true, simulated: true }; // Slack / Teams / Outlook connect later
  if (!r.ok) throw new Error(r.error ?? "Send failed");
  await addMessage({ conv_id: convId, direction: "out", text, ack: opts.ack ? 1 : 0, sent_by: opts.by ?? "me", status: r.simulated ? "simulated" : "sent", external_id: r.id ?? null, via });
  await updateConversation(convId, { suggestion: null, suggestion_for: null, reminded_at: null });
  return { simulated: !!r.simulated, channel: c.channel, name: c.name, via };
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
  const waTo = process.env.REMINDER_WHATSAPP_TO;
  const mailTo = process.env.REMINDER_EMAIL_TO;
  const useWa = !!waTo && (await waConfigured());
  const mailFrom = mailTo ? await reminderMailbox() : null;
  if (!useWa && !mailFrom) return;
  const every = Number(process.env.REMINDER_MINUTES ?? 10) * 60_000;
  const defaultAfter = Number(process.env.REMINDER_AFTER_MINUTES ?? 5);
  const now = Date.now();
  const due = [];
  for (const c of await listConversations()) {
    if (!c.waiting || c.demo || !c.waitingSince || now - c.waitingSince < (c.remindAfter ?? defaultAfter) * 60_000) continue;
    const conv = await getConversation(c.id);
    if (!conv?.reminded_at || now - Number(conv.reminded_at) > every) due.push(c);
  }
  if (!due.length) return;
  const title = `${due.length} client${due.length > 1 ? "s" : ""} waiting for your reply`;
  const url = process.env.PUBLIC_URL;
  let ok = false;
  if (useWa) {
    const lines = due.map((c) => {
      const mins = Math.round((now - (c.waitingSince ?? now)) / 60000);
      return `• *${c.name}* (${c.channel}, waiting ${mins}m)\n  "${(c.last?.text ?? "").slice(0, 90)}"${c.suggestion ? `\n  Suggested: ${c.suggestion}` : ""}`;
    });
    ok = (await sendWhatsApp(waTo!, `⏰ ${title}\n\n${lines.join("\n\n")}${url ? `\n\nOpen: ${url}` : ""}`)).ok || ok;
  }
  if (mailFrom) {
    const lines = due.map((c) => {
      const mins = Math.round((now - (c.waitingSince ?? now)) / 60000);
      return `${c.name} (${c.channel}, waiting ${mins} min)\n  "${(c.last?.text ?? "").slice(0, 200)}"${c.suggestion ? `\n  Suggested reply: ${c.suggestion}` : ""}${url ? `\n  Open: ${url}/inbox?c=${c.id}` : ""}`;
    });
    const r = await sendEmail(mailFrom, mailTo!, `GAC Desk: ${title}`, `${title}\n\n${lines.join("\n\n")}`, false).catch((e) => ({ ok: false, error: String(e) }));
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

  // After a restart, draft replies for anyone still waiting without one
  setTimeout(async () => {
    try {
      for (const c of await listConversations()) if (c.waiting && !c.demo && !c.suggestion) afterIncoming(c.id);
    } catch (e) {
      log("startup-error", String(e));
    }
  }, 8_000);
}
