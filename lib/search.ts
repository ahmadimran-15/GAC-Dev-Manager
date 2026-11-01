import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { all } from "@/lib/db";
import { emailAccounts } from "@/lib/email";
import { searchTasks } from "@/lib/clickup";

// Look-ups the assistant can run: ClickUp tasks (with comments/Looms), mailboxes, and stored chats.

export async function searchClickUp(query: string) {
  const tasks = await searchTasks(query);
  if (!tasks.length) return "No matching ClickUp tasks.";
  return tasks
    .map(
      (t) =>
        `TASK "${t.title}" · project "${t.project}" (${t.stage ?? "?"}) · ${t.status} · ${t.assignee} · ${t.url}\n` +
        (t.description ? `Description: ${t.description.slice(0, 600)}\n` : "") +
        (t.looms.length ? `Loom links: ${t.looms.join(" , ")}\n` : "") +
        (t.comments.length ? `Comments (newest first):\n${t.comments.slice(0, 8).map((c) => `- ${c.user} (${new Date(c.at).toLocaleDateString("en-GB")}): ${c.text.slice(0, 400)}`).join("\n")}` : "No comments."),
    )
    .join("\n\n");
}

export async function searchEmail(query: string) {
  const words = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
  const out: string[] = [];
  for (const acc of emailAccounts()) {
    const client = new ImapFlow({ host: acc.imapHost, port: acc.imapPort, secure: true, auth: { user: acc.user, pass: acc.pass }, logger: false });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const since = new Date(Date.now() - 120 * 86400_000);
        const term = words.join(" ") || query;
        const uids = (await client.search({ since, or: [{ subject: term }, { body: term }, { from: term }] }, { uid: true })) || [];
        for (const uid of uids.slice(-6).reverse()) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const mail = await simpleParser(msg.source);
          out.push(`EMAIL [${acc.label}] from ${mail.from?.text ?? "?"} · ${mail.date?.toLocaleDateString("en-GB") ?? ""} · "${mail.subject ?? ""}"\n${(mail.text ?? "").replace(/\s+/g, " ").slice(0, 700)}`);
        }
      } finally {
        lock.release();
      }
    } catch (e) {
      out.push(`(${acc.label} search failed: ${e instanceof Error ? e.message : e})`);
    } finally {
      await client.logout().catch(() => {});
    }
  }
  return out.length ? out.join("\n\n") : emailAccounts().length ? "No matching emails." : "No email accounts are connected yet.";
}

export function searchMessages(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 5);
  if (!words.length) return "No search words.";
  const rows = all<{ name: string; channel: string; direction: string; text: string | null; transcript: string | null; created_at: number }>(
    `select c.name, c.channel, m.direction, m.text, m.transcript, m.created_at from messages m join conversations c on c.id = m.conv_id
     where ${words.map(() => "lower(coalesce(m.text,'') || ' ' || coalesce(m.transcript,'') || ' ' || c.name) like ?").join(" and ")}
     order by m.created_at desc limit 12`,
    ...words.map((w) => `%${w}%`),
  );
  return rows.length
    ? rows.map((r) => `MESSAGE ${r.direction === "in" ? `from ${r.name}` : `to ${r.name}`} (${r.channel}, ${new Date(r.created_at).toLocaleString("en-GB")}): ${r.text ?? r.transcript}`).join("\n")
    : "No matching messages.";
}
