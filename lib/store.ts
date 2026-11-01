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
  created_at: number;
}

export interface ConvSummary {
  id: string;
  channel: string;
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
  last: { text: string; kind: string; direction: string; at: number } | null;
}

export const msgText = (m: Pick<Message, "text" | "transcript" | "kind">) =>
  m.text || m.transcript || (m.kind === "voice" ? "Voice note" : m.kind === "image" ? "Image" : m.kind === "file" ? "File" : "");

export function getConversation(id: string) {
  return get<Conversation>("select * from conversations where id = ?", id);
}

export function findOrCreateConversation(c: { channel: string; externalId: string; account?: string; name: string; company?: string; subject?: string }) {
  const existing = get<Conversation>("select * from conversations where channel = ? and external_id = ? and account = ?", c.channel, c.externalId, c.account ?? "");
  if (existing) {
    // keep the best-known display name (a phone number gets replaced by a real name)
    if (c.name && /^\+?\d+$/.test(existing.name) && !/^\+?\d+$/.test(c.name)) run("update conversations set name = ? where id = ?", c.name, existing.id);
    return existing;
  }
  const id = uid("c_");
  run(
    "insert into conversations (id, channel, external_id, account, name, company, subject, created_at) values (?,?,?,?,?,?,?,?)",
    id, c.channel, c.externalId, c.account ?? "", c.name, c.company ?? null, c.subject ?? null, Date.now(),
  );
  return getConversation(id)!;
}

export function addMessage(m: Partial<Message> & { conv_id: string; direction: "in" | "out" }) {
  if (m.external_id && get("select 1 from messages where conv_id = ? and external_id = ?", m.conv_id, m.external_id)) return null;
  const id = m.id ?? uid("m_");
  run(
    "insert into messages (id, conv_id, direction, kind, text, transcript, media_path, media_mime, external_id, ack, sent_by, status, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, m.conv_id, m.direction, m.kind ?? "text", m.text, m.transcript, m.media_path, m.media_mime, m.external_id, m.ack ?? 0, m.sent_by, m.status, m.created_at ?? Date.now(),
  );
  // A new client message reopens the conversation; any reply clears the reminder clock
  if (m.direction === "in") run("update conversations set status = 'open', reminded_at = null where id = ?", m.conv_id);
  return id;
}

export function getMessages(convId: string) {
  return all<Message>("select * from messages where conv_id = ? order by created_at", convId);
}

export function updateMessage(id: string, fields: Partial<Message>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  run(`update messages set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`, ...keys.map((k) => (fields as Row)[k]), id);
}

export function updateConversation(id: string, fields: Partial<Conversation>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  run(`update conversations set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`, ...keys.map((k) => (fields as Row)[k]), id);
}

export function summarize(c: Conversation): ConvSummary {
  const lastOut = get<{ t: number | null; ack: number }>("select created_at t, ack from messages where conv_id = ? and direction = 'out' order by created_at desc limit 1", c.id);
  const pending = get<{ t: number | null; n: number }>("select min(created_at) t, count(*) n from messages where conv_id = ? and direction = 'in' and created_at > ?", c.id, lastOut?.t ?? 0)!;
  const last = get<Message>("select * from messages where conv_id = ? order by created_at desc limit 1", c.id);
  const waiting = c.status !== "handled" && pending.n > 0;
  return {
    id: c.id,
    channel: c.channel,
    account: c.account,
    name: c.name,
    company: c.company,
    project: c.project,
    status: c.status,
    demo: !!c.demo,
    waiting,
    waitingSince: waiting ? pending.t : null,
    unanswered: waiting ? pending.n : 0,
    acknowledged: !waiting && !!lastOut?.ack,
    suggestion: waiting ? c.suggestion : null,
    last: last ? { text: msgText(last), kind: last.kind, direction: last.direction, at: last.created_at } : null,
  };
}

export function listConversations(): ConvSummary[] {
  return all<Conversation>("select * from conversations").map(summarize).sort((a, b) => {
    if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
    if (a.waiting) return (a.waitingSince ?? 0) - (b.waitingSince ?? 0);
    return (b.last?.at ?? 0) - (a.last?.at ?? 0);
  });
}

// Average minutes from a client's first unanswered message to our first reply, for replies sent today.
export function firstReplyToday(): { avg: number | null; count: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = all<{ conv_id: string; direction: string; created_at: number }>(
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

export function addDraft(d: { conv_id: string | null; project: string | null; author: string; text: string }) {
  const id = uid("d_");
  run("insert into drafts (id, conv_id, project, author, text, created_at) values (?,?,?,?,?,?)", id, d.conv_id, d.project, d.author, d.text, Date.now());
  return id;
}

export function setDraftStatus(id: string, status: "approved" | "discarded") {
  run("update drafts set status = ? where id = ?", status, id);
}

export const getDraft = (id: string) => get<Draft>("select * from drafts where id = ?", id);
