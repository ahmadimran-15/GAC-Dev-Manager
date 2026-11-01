import { logEvent } from "@/lib/db";
import { aiConfigured, suggestReply, transcribe, transcriptionConfigured } from "@/lib/ai";
import { accountForSession, downloadMedia, parseIncoming, sendWhatsApp, waConfigured } from "@/lib/whatsapp";
import { pollAll, sendEmail } from "@/lib/email";
import { defaultSender, getAccount } from "@/lib/accounts";
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

// Sends you a WhatsApp summary of clients still waiting, with the suggested reply for each.
async function remindOnWhatsApp() {
  const to = process.env.REMINDER_WHATSAPP_TO;
  if (!to || !(await waConfigured())) return;
  const every = Number(process.env.REMINDER_MINUTES ?? 10) * 60_000;
  const after = Number(process.env.REMINDER_AFTER_MINUTES ?? 5) * 60_000;
  const now = Date.now();
  const due = [];
  for (const c of await listConversations()) {
    if (!c.waiting || c.demo || !c.waitingSince || now - c.waitingSince < after) continue;
    const conv = await getConversation(c.id);
    if (!conv?.reminded_at || now - Number(conv.reminded_at) > every) due.push(c);
  }
  if (!due.length) return;
  const lines = due.map((c) => {
    const mins = Math.round((now - (c.waitingSince ?? now)) / 60000);
    return `• *${c.name}* (${c.channel}, waiting ${mins}m)\n  "${(c.last?.text ?? "").slice(0, 90)}"${c.suggestion ? `\n  Suggested: ${c.suggestion}` : ""}`;
  });
  const url = process.env.PUBLIC_URL ? `\n\nOpen: ${process.env.PUBLIC_URL}` : "";
  const r = await sendWhatsApp(to, `⏰ ${due.length} client${due.length > 1 ? "s" : ""} waiting for your reply\n\n${lines.join("\n\n")}${url}`);
  if (r.ok) for (const c of due) await updateConversation(c.id, { reminded_at: now });
}

export function startWorker() {
  const g = globalThis as unknown as { __gacWorker?: boolean };
  if (g.__gacWorker) return;
  g.__gacWorker = true;

  // Mailboxes can be added any time in Settings, so always keep checking
  setTimeout(pollEmail, 5_000);
  setInterval(pollEmail, 60_000);
  setInterval(() => remindOnWhatsApp().catch((e) => log("reminder-error", String(e))), 60_000);

  // After a restart, draft replies for anyone still waiting without one
  setTimeout(async () => {
    try {
      for (const c of await listConversations()) if (c.waiting && !c.demo && !c.suggestion) afterIncoming(c.id);
    } catch (e) {
      log("startup-error", String(e));
    }
  }, 8_000);
}
