import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { kvGet, kvSet, logEvent } from "@/lib/db";
import { addMessage, findOrCreateConversation, updateConversation } from "@/lib/store";

// Email accounts over IMAP (read) and SMTP (reply). Configure EMAIL1_*, EMAIL2_*, ... in .env.
// Titan and Zoho work with your normal password; Gmail needs an App Password.

const PRESETS: Record<string, { imap: string; smtp: string; smtpPort: number }> = {
  titan: { imap: "imap.titan.email", smtp: "smtp.titan.email", smtpPort: 465 },
  gmail: { imap: "imap.gmail.com", smtp: "smtp.gmail.com", smtpPort: 465 },
  zoho: { imap: "imap.zoho.com", smtp: "smtp.zoho.com", smtpPort: 465 },
};

export interface EmailAccount {
  label: string;
  user: string;
  pass: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export function emailAccounts(): EmailAccount[] {
  const out: EmailAccount[] = [];
  for (let i = 1; i <= 9; i++) {
    const e = (k: string) => process.env[`EMAIL${i}_${k}`];
    if (!e("USER") || !e("PASS")) continue;
    const preset = PRESETS[(e("PROVIDER") ?? "").toLowerCase()];
    out.push({
      label: e("LABEL") ?? e("PROVIDER") ?? `Email ${i}`,
      user: e("USER")!,
      pass: e("PASS")!,
      imapHost: e("IMAP_HOST") ?? preset?.imap ?? "",
      imapPort: Number(e("IMAP_PORT") ?? 993),
      smtpHost: e("SMTP_HOST") ?? preset?.smtp ?? "",
      smtpPort: Number(e("SMTP_PORT") ?? preset?.smtpPort ?? 465),
    });
  }
  return out;
}

const NOISE = /(no-?reply|notifications?|mailer-daemon|newsletter|marketing|bounce)@/i;

function stripQuoted(text: string) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || /^From: /.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
}

// Pull new messages from one inbox. Tracks the last UID so mail is imported once and never marked read.
export async function pollAccount(acc: EmailAccount, onNew: (convId: string) => void) {
  const client = new ImapFlow({ host: acc.imapHost, port: acc.imapPort, secure: true, auth: { user: acc.user, pass: acc.pass }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const kvKey = `imap_uid_${acc.user}`;
    const status = await client.status("INBOX", { uidNext: true });
    const next = Number((status && status.uidNext) || 1);
    let last = Number(kvGet(kvKey) ?? 0);
    if (!last) last = Math.max(0, next - 15); // first run: only the latest few emails
    if (next - 1 <= last) return 0;
    let count = 0;
    for await (const msg of client.fetch(`${last + 1}:*`, { uid: true, source: true, envelope: true }, { uid: true })) {
      last = Math.max(last, Number(msg.uid));
      if (!msg.source) continue;
      const mail = await simpleParser(msg.source);
      const from = mail.from?.value?.[0];
      if (!from?.address || from.address.toLowerCase() === acc.user.toLowerCase() || NOISE.test(from.address) || mail.headers.has("list-unsubscribe")) continue;
      const conv = findOrCreateConversation({ channel: "email", externalId: from.address.toLowerCase(), account: acc.label, name: from.name || from.address, subject: mail.subject ?? undefined });
      if (mail.subject) updateConversation(conv.id, { subject: mail.subject });
      const body = stripQuoted(mail.text ?? "").slice(0, 4000);
      const id = addMessage({ conv_id: conv.id, direction: "in", text: (mail.subject && !conv.subject ? `${mail.subject}\n\n` : "") + body, external_id: mail.messageId ?? `uid-${msg.uid}`, created_at: mail.date?.getTime() ?? Date.now() });
      if (id) {
        count++;
        onNew(conv.id);
      }
    }
    kvSet(kvKey, String(last));
    return count;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

export async function sendEmail(accountLabel: string, to: string, subject: string | null, text: string) {
  const acc = emailAccounts().find((a) => a.label === accountLabel);
  if (!acc) return { ok: true, simulated: true };
  try {
    const t = nodemailer.createTransport({ host: acc.smtpHost, port: acc.smtpPort, secure: acc.smtpPort === 465, auth: { user: acc.user, pass: acc.pass } });
    const info = await t.sendMail({ from: acc.user, to, subject: subject ? (subject.startsWith("Re:") ? subject : `Re: ${subject}`) : "Re: your message", text });
    return { ok: true, id: info.messageId };
  } catch (e) {
    logEvent("smtp-error", { account: accountLabel, error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "SMTP failed" };
  }
}
