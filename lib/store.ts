import { all, get, run, uid, type Row } from "@/lib/db";

export interface Conversation {
  id: string;
  channel: string;
  external_id: string;
  account: string;
  name: string;
  company: string | null;
  project: string | null;
  subject: string | null;
  status: "open" | "handled";
  suggestion: string | null;
  suggestion_for: string | null;
  reminded_at: number | null;
  remind_after: number | null; // minutes before reminders start for this client (null = default)
  internal: number; // a chat with someone on our side (never "waiting")
  context: string | null; // AI summary of what's going on in this chat
  context_at: number | null;
  demo: number;
  created_at: number;
}

export interface Message {
  id: string;
  conv_id: string;
  direction: "in" | "out";
  kind: "text" | "voice" | "image" | "file";
  text: string | null;
  transcript: string | null;
  media_path: string | null;
  media_mime: string | null;
  external_id: string | null;
  ack: number;
  sent_by: string | null;
  status: string | null;
  via: string | null; // which of our accounts received or sent it
  created_at: number;
}

export interface ConvSummary {
  id: string;
  channel: string;
  externalId: string; // email address, phone number or WhatsApp group id (owner view only)
  account: string;
  name: string;
  company: string | null;
  project: string | null;
  status: string;
  demo: boolean;
  waiting: boolean;
  waitingSince: number | null;
  unanswered: number;
  acknowledged: boolean;
  suggestion: string | null;
  remindAfter: number | null;
  internal: boolean;
  repliedBy: { name: string; at: number } | null; // last reply came from a teammate, not you
  context: string | null;
  contextAt: number | null;
  last: { text: string; kind: string; direction: string; at: number } | null;
}

export const msgText = (m: Pick<Message, "text" | "transcript" | "kind">) =>
  m.text || m.transcript || (m.kind === "voice" ? "Voice note" : m.kind === "image" ? "Image" : m.kind === "file" ? "File" : "");

export function getConversation(id: string) {
  return get<Conversation>("select * from conversations where id = ?", id);
}

export async function findOrCreateConversation(c: { channel: string; externalId: string; account?: string; name: string; company?: string; subject?: string }) {
  const existing = await get<Conversation>("select * from conversations where channel = ? and external_id = ? and account = ?", c.channel, c.externalId, c.account ?? "");
  if (existing) {
    // keep the best-known display name (a phone number gets replaced by a real name)
    if (c.name && /^\+?\d+$/.test(existing.name) && !/^\+?\d+$/.test(c.name)) await run("update conversations set name = ? where id = ?", c.name, existing.id);
    return existing;
  }
  const id = uid("c_");
  await run(
    "insert into conversations (id, channel, external_id, account, name, company, subject, created_at) values (?,?,?,?,?,?,?,?) on conflict (channel, external_id, account) do nothing",
    id, c.channel, c.externalId, c.account ?? "", c.name, c.company ?? null, c.subject ?? null, Date.now(),
  );
  return (await get<Conversation>("select * from conversations where channel = ? and external_id = ? and account = ?", c.channel, c.externalId, c.account ?? ""))!;
}

export async function addMessage(m: Partial<Message> & { conv_id: string; direction: "in" | "out" }) {
  if (m.external_id && (await get("select 1 from messages where conv_id = ? and external_id = ?", m.conv_id, m.external_id))) return null;
  const id = m.id ?? uid("m_");
  await run(
    "insert into messages (id, conv_id, direction, kind, text, transcript, media_path, media_mime, external_id, ack, sent_by, status, via, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, m.conv_id, m.direction, m.kind ?? "text", m.text, m.transcript, m.media_path, m.media_mime, m.external_id, m.ack ?? 0, m.sent_by, m.status, m.via, m.created_at ?? Date.now(),
  );
  // A new client message reopens the conversation; any reply clears the reminder clock
  if (m.direction === "in") await run("update conversations set status = 'open', reminded_at = null where id = ?", m.conv_id);
  return id;
}

// Many messages at once (history import). Already-stored ones (same conversation + external id) are skipped.
const MSG_COLS = ["id", "conv_id", "direction", "kind", "text", "external_id", "sent_by", "status", "via", "created_at"] as const;
export async function insertMessages(rows: (Partial<Message> & { conv_id: string; direction: "in" | "out"; external_id: string; created_at: number })[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.flatMap((m) => [uid("m_"), m.conv_id, m.direction, m.kind ?? "text", m.text ?? null, m.external_id, m.sent_by ?? null, m.status ?? null, m.via ?? null, m.created_at]);
    await run(`insert into messages (${MSG_COLS.join(", ")}) values ${chunk.map(() => `(${MSG_COLS.map(() => "?").join(",")})`).join(", ")} on conflict do nothing`, ...values);
  }
}

export function getMessages(convId: string) {
  return all<Message>("select * from messages where conv_id = ? order by created_at", convId);
}

export async function updateMessage(id: string, fields: Partial<Message>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await run(`update messages set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`, ...keys.map((k) => (fields as Row)[k]), id);
}

export async function updateConversation(id: string, fields: Partial<Conversation>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await run(`update conversations set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`, ...keys.map((k) => (fields as Row)[k]), id);
}

// One query for every conversation's waiting state (works on Postgres and SQLite), one for last messages.
const SUMMARY_SQL = (where: string) => `
with x as (
  select c.*, (select max(m.created_at) from messages m where m.conv_id = c.id and m.direction = 'out') lo_t
  from conversations c ${where}
)
select x.*,
  (select m.ack from messages m where m.conv_id = x.id and m.direction = 'out' order by m.created_at desc limit 1) lo_ack,
  (select m.sent_by from messages m where m.conv_id = x.id and m.direction = 'out' order by m.created_at desc limit 1) lo_by,
  (select min(m.created_at) from messages m where m.conv_id = x.id and m.direction = 'in' and m.created_at > coalesce(x.lo_t, 0)) pend_t,
  (select count(*) from messages m where m.conv_id = x.id and m.direction = 'in' and m.created_at > coalesce(x.lo_t, 0)) pend_n,
  (select m.id from messages m where m.conv_id = x.id order by m.created_at desc limit 1) last_id
from x`;

async function summaries(where = "", ...p: unknown[]): Promise<ConvSummary[]> {
  const rows = await all<Conversation & { lo_ack: number | null; lo_t: number | null; lo_by: string | null; pend_t: number | null; pend_n: number; last_id: string | null }>(SUMMARY_SQL(where), ...p);
  const ids = rows.map((r) => r.last_id).filter(Boolean) as string[];
  const lasts = ids.length ? await all<Message>(`select * from messages where id in (${ids.map(() => "?").join(",")})`, ...ids) : [];
  const byId = new Map(lasts.map((m) => [m.id, m]));
  return rows.map((c) => {
    const last = c.last_id ? byId.get(c.last_id) : undefined;
    const waiting = c.status !== "handled" && !c.internal && Number(c.pend_n) > 0;
    // "me" = sent here, "phone" = your phone; anything else is a teammate's name or a team portal author
    const byTeammate = c.lo_by && !["me", "phone"].includes(c.lo_by) ? c.lo_by : null;
    return {
      id: c.id,
      channel: c.channel,
      externalId: c.external_id,
      account: c.account,
      name: c.name,
      company: c.company,
      project: c.project,
      status: c.status,
      demo: !!c.demo,
      waiting,
      waitingSince: waiting && c.pend_t !== null ? Number(c.pend_t) : null,
      unanswered: waiting ? Number(c.pend_n) : 0,
      acknowledged: !waiting && !!c.lo_ack,
      suggestion: waiting ? c.suggestion : null,
      remindAfter: c.remind_after === null || c.remind_after === undefined ? null : Number(c.remind_after),
      internal: !!c.internal,
      repliedBy: !waiting && byTeammate && c.lo_t ? { name: byTeammate, at: Number(c.lo_t) } : null,
      context: c.context ?? null,
      contextAt: c.context_at ? Number(c.context_at) : null,
      last: last ? { text: msgText(last), kind: last.kind, direction: last.direction, at: Number(last.created_at) } : null,
    };
  });
}

export async function summarize(id: string): Promise<ConvSummary | undefined> {
  return (await summaries("where c.id = ?", id))[0];
}

export async function listConversations(): Promise<ConvSummary[]> {
  const list = await summaries();
  return list.sort((a, b) => {
    if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
    if (a.waiting) return (a.waitingSince ?? 0) - (b.waitingSince ?? 0);
    return (b.last?.at ?? 0) - (a.last?.at ?? 0);
  });
}

// Average minutes from a client's first unanswered message to our first reply, for replies sent today.
export async function firstReplyToday(): Promise<{ avg: number | null; count: number }> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await all<{ conv_id: string; direction: string; created_at: number }>(
    "select conv_id, direction, created_at from messages where created_at > ? order by conv_id, created_at",
    start.getTime() - 24 * 3600_000,
  );
  const waits: number[] = [];
  let conv = "";
  let waitingFrom: number | null = null;
  for (const r of rows) {
    if (r.conv_id !== conv) {
      conv = r.conv_id;
      waitingFrom = null;
    }
    if (r.direction === "in" && waitingFrom === null) waitingFrom = r.created_at;
    if (r.direction === "out" && waitingFrom !== null) {
      if (r.created_at >= start.getTime()) waits.push((r.created_at - waitingFrom) / 60000);
      waitingFrom = null;
    }
  }
  return { avg: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null, count: waits.length };
}

// ---------- Team drafts ----------

export interface Draft {
  id: string;
  conv_id: string | null;
  project: string | null;
  author: string;
  text: string;
  status: string;
  created_at: number;
}

export function listDrafts() {
  return all<Draft & { conv_name: string | null; channel: string | null }>(
    "select d.*, c.name conv_name, c.channel channel from drafts d left join conversations c on c.id = d.conv_id where d.status = 'pending' order by d.created_at",
  );
}

export async function addDraft(d: { conv_id: string | null; project: string | null; author: string; author_id?: string | null; text: string }) {
  const id = uid("d_");
  await run("insert into drafts (id, conv_id, project, author, author_id, text, created_at) values (?,?,?,?,?,?,?)", id, d.conv_id, d.project, d.author, d.author_id ?? null, d.text, Date.now());
  return id;
}

export async function setDraftStatus(id: string, status: "approved" | "discarded", sentTo?: string) {
  await run("update drafts set status = ?, sent_to = ? where id = ?", status, sentTo ?? null, id);
}

export const getDraft = (id: string) => get<Draft>("select * from drafts where id = ?", id);
