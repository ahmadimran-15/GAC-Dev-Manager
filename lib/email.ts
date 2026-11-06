import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { classifyMail } from "@/lib/mailfilter";
import { kvGet, kvSet } from "@/lib/db";
import { accountsWithSecrets, getAccount, setAccountStatus, type AccountConfig, type AccountWithSecret } from "@/lib/accounts";
import { addMessage, findOrCreateConversation, updateConversation } from "@/lib/store";

// All company mailboxes (added in Settings) are read over IMAP and answered over SMTP.

export interface MailCreds {
  address: string;
  secret: string;
  config: AccountConfig;
}

const imapClient = (a: MailCreds) =>
  new ImapFlow({ host: a.config.imapHost!, port: a.config.imapPort ?? 993, secure: (a.config.imapPort ?? 993) === 993, auth: { user: a.config.username || a.address, pass: a.secret }, logger: false });

const smtpTransport = (a: MailCreds) =>
  nodemailer.createTransport({ host: a.config.smtpHost, port: a.config.smtpPort ?? 465, secure: (a.config.smtpPort ?? 465) === 465, auth: { user: a.config.username || a.address, pass: a.secret } });

export const emailAccounts = () => accountsWithSecrets("email");

// Checks a mailbox before it's saved: can we read (IMAP) and send (SMTP)?
export async function testMailbox(a: MailCreds) {
  const out = { imap: "", smtp: "", ok: false };
  const c = imapClient(a);
  try {
    await c.connect();
    const s = await c.status("INBOX", { messages: true, unseen: true });
    out.imap = `OK · ${s && s.messages} emails, ${s && s.unseen} unread`;
    await c.logout();
  } catch (e) {
    out.imap = `Failed: ${(e as { responseText?: string }).responseText || (e instanceof Error ? e.message : String(e))}`;
  }
  try {
    await smtpTransport(a).verify();
    out.smtp = "OK";
  } catch (e) {
    out.smtp = `Failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
  }
  out.ok = out.imap.startsWith("OK") && out.smtp === "OK";
  return out;
}


function stripQuoted(text: string) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || /^From: /.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
}

// Pull new mail from one inbox. Tracks the last UID so mail is imported once and never marked as read.
export async function pollAccount(acc: AccountWithSecret, onNew: (convId: string) => void) {
  const client = imapClient(acc);
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const kvKey = `imap_uid_${acc.id}`;
    const status = await client.status("INBOX", { uidNext: true });
    const next = Number((status && status.uidNext) || 1);
    let last = Number((await kvGet(kvKey)) ?? 0);
    if (!last) last = Math.max(0, next - 10); // first run: only the latest few emails
    if (next - 1 <= last) return 0;
    let count = 0;
    for await (const msg of client.fetch(`${last + 1}:*`, { uid: true, source: true }, { uid: true })) {
      last = Math.max(last, Number(msg.uid));
      if (!msg.source) continue;
      const mail = await simpleParser(msg.source);
      const from = mail.from?.value?.[0];
      if (!from?.address) continue;
      const sender = from.address.toLowerCase();
      // Our own outgoing copies and the other company mailboxes are the only mail still skipped.
      if ((await accountsWithSecrets("email", false)).some((a) => a.address.toLowerCase() === sender)) continue;
      // Everything else is kept. A newsletter, receipt or service notice is filed under Updates
      // rather than discarded, so a wrong call costs one click instead of a lost client email.
      const verdict = await classifyMail(sender, mail.headers as unknown as Map<string, unknown>);
      const conv = await findOrCreateConversation({ channel: "email", externalId: sender, account: acc.address, name: from.name || from.address, subject: mail.subject ?? undefined });
      if (mail.subject) await updateConversation(conv.id, { subject: mail.subject });
      // Moving a thread back to the clients by hand puts the sender on the allow list, which the
      // classifier checks first, so a later newsletter from them cannot drag it back under Updates.
      if (verdict.bulk !== !!conv.bulk) await updateConversation(conv.id, { bulk: verdict.bulk ? 1 : 0 });
      const body = stripQuoted(mail.text ?? "").slice(0, 4000);
      const id = await addMessage({
        conv_id: conv.id,
        direction: "in",
        text: (mail.subject ? `${mail.subject}\n\n` : "") + body,
        external_id: mail.messageId ?? `uid-${acc.id}-${msg.uid}`,
        created_at: mail.date?.getTime() ?? Date.now(),
        via: acc.address,
      });
      if (id) {
        count++;
        onNew(conv.id);
      }
    }
    await kvSet(kvKey, String(last));
    return count;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

export async function pollAll(onNew: (convId: string) => void) {
  for (const acc of await emailAccounts()) {
    try {
      await pollAccount(acc, onNew);
      await setAccountStatus(acc.id, true);
    } catch (e) {
      await setAccountStatus(acc.id, false, (e as { responseText?: string }).responseText || (e instanceof Error ? e.message : String(e)));
    }
  }
}

// reply=false sends a fresh message (no "Re:"), e.g. reminders to yourself
export async function sendEmail(fromAccountId: string, to: string, subject: string | null, text: string, reply = true) {
  const acc = await getAccount(fromAccountId);
  if (!acc) return { ok: false, error: "That mailbox no longer exists" };
  try {
    const info = await smtpTransport(acc).sendMail({
      from: acc.label && !acc.label.includes("@") ? `"${acc.label}" <${acc.address}>` : acc.address,
      to,
      subject: !reply ? (subject ?? "") : subject ? (/^re:/i.test(subject) ? subject : `Re: ${subject}`) : "Re: your message",
      text,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "SMTP failed" };
  }
}
