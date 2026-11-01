import fs from "fs";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";
import { MEDIA_DIR } from "@/lib/db";
import { accountsWithSecrets, getAccount, type AccountWithSecret } from "@/lib/accounts";

// ChatSlash / OpenWA self-hosted WhatsApp gateway. Each WhatsApp number is an account (session) added in Settings.

const base = (a: AccountWithSecret) => (a.config.baseUrl ?? "").replace(/\/$/, "");

async function wa<T>(a: AccountWithSecret, p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base(a)}/api/sessions/${a.config.sessionId}${p}`, {
    ...init,
    headers: { "x-api-key": a.secret, accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ? [data.message].flat().join(", ") : `WhatsApp gateway error ${res.status}`);
  return data as T;
}

export const waAccounts = () => accountsWithSecrets("whatsapp");
export const waConfigured = async () => (await waAccounts()).length > 0;
const pick = async (id?: string | null) => (id ? await getAccount(id) : null) ?? (await waAccounts()).find((a) => a.canSend) ?? null;

const chatIdFor = (to: string) => (to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@c.us`);

// opts.quotedMessageId turns the send into a reply to that message; opts.mentions = ["923…@c.us"]
// (the text must contain "@923…" for each). A quote the gateway can't resolve is retried without it.
export async function sendWhatsApp(
  to: string,
  text: string,
  accountId?: string | null,
  opts: { quotedMessageId?: string | null; mentions?: string[] } = {},
): Promise<{ ok: boolean; simulated?: boolean; id?: string; error?: string; quoted?: boolean }> {
  const a = await pick(accountId);
  if (!a) return { ok: true, simulated: true };
  const body = { chatId: chatIdFor(to), text, ...(opts.mentions?.length ? { mentions: opts.mentions } : {}) };
  const sendOnce = async (quoted?: string | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await wa<any>(a, "/messages/send-text", { method: "POST", body: JSON.stringify(quoted ? { ...body, quotedMessageId: quoted } : body) });
    return String(r?.messageId ?? r?.waMessageId ?? r?.id ?? "") || undefined;
  };
  try {
    if (opts.quotedMessageId) {
      try {
        return { ok: true, id: await sendOnce(opts.quotedMessageId), quoted: true };
      } catch {
        /* quote not resolvable on this engine: send it as a normal message */
      }
    }
    return { ok: true, id: await sendOnce(), quoted: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "WhatsApp send failed" };
  }
}

// "@TuLab please check" → "@92300… please check" + mentions, using saved contacts and team numbers.
// In a group only its members are considered when the gateway lists them.
export async function resolveMentions(text: string, people: { name: string; number: string }[]) {
  if (!text.includes("@")) return { text, mentions: [] as string[] };
  const mentions = new Set<string>();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text;
  // Longest names first so "@Muhammad Ali" wins over "@Muhammad"; then unique first names
  const firsts = new Map<string, { name: string; number: string }[]>();
  for (const p of people) {
    const f = p.name.split(/\s+/)[0].toLowerCase();
    firsts.set(f, [...(firsts.get(f) ?? []), p]);
  }
  const candidates = [
    ...[...people].sort((x, y) => y.name.length - x.name.length).map((p) => ({ token: p.name, number: p.number })),
    ...[...firsts].filter(([, l]) => l.length === 1).map(([f, l]) => ({ token: f, number: l[0].number })),
  ].filter((c) => c.token.length >= 3 && c.number);
  for (const c of candidates) {
    const re = new RegExp(`@${esc(c.token)}(?![\\p{L}\\p{N}])`, "giu");
    if (re.test(out)) {
      out = out.replace(re, `@${c.number}`);
      mentions.add(`${c.number}@c.us`);
    }
  }
  return { text: out, mentions: [...mentions] };
}

// Phone numbers of a group's members (for mentions); empty if the gateway can't tell
export async function groupMembers(a: AccountWithSecret, groupId: string): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = await wa<any>(a, `/groups/${encodeURIComponent(groupId)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = g?.participants ?? g?.data?.participants ?? [];
    return list.map((p) => String(p?.phone ?? p?.number ?? p?.id?._serialized ?? p?.id ?? "").split("@")[0].replace(/[^\d]/g, "")).filter(Boolean);
  } catch {
    return [];
  }
}

export async function sessionStatus(a: AccountWithSecret) {
  try {
    return await wa<{ status: string; phone: string; pushName: string }>(a, "");
  } catch (e) {
    return { status: "error", phone: "", pushName: e instanceof Error ? e.message : "" };
  }
}

// Lists the sessions an API key can use, so a number can be picked in Settings.
export async function listSessions(baseUrl: string, apiKey: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/sessions`, { headers: { "x-api-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `Gateway error ${res.status}`);
  const list = Array.isArray(data) ? data : (data?.data ?? data?.sessions ?? []);
  return list.map((s: { id: string; name?: string; phone?: string; status?: string; pushName?: string }) => ({ id: s.id, name: s.name ?? "", phone: s.phone ?? "", status: s.status ?? "", pushName: s.pushName ?? "" }));
}

// Registers (or updates) this dashboard's webhook on a session. Other webhooks (e.g. n8n) are left alone.
export async function registerWebhook(a: AccountWithSecret, url: string) {
  const body = { url, events: ["message.received", "message.sent", "message.ack", "message.failed"], secret: process.env.WA_WEBHOOK_SECRET || undefined, retryCount: 3 };
  const list = await wa<{ id: string; url: string }[]>(a, "/webhooks");
  const mine = list.find((w) => w.url.includes("/api/webhooks/whatsapp"));
  if (mine) return wa(a, `/webhooks/${mine.id}`, { method: "PUT", body: JSON.stringify(body) });
  return wa(a, "/webhooks", { method: "POST", body: JSON.stringify(body) });
}

// HMAC check of the X-OpenWA-Signature header (sha256=<hex> of the raw body).
export function verifySignature(raw: string, header: string | null) {
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!header) return false;
  const want = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(want);
  const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Incoming {
  id: string;
  sessionId: string | null;
  isGroup: boolean;
  author: string; // who wrote it (in a group: the member)
  senderId: string; // the writer's WhatsApp id (123@c.us, or a hidden 123@lid in some groups)
  fromMe: boolean;
  phone: string; // the client's number (for your own messages: who you wrote to)
  chatId: string;
  name: string;
  text: string;
  kind: "text" | "voice" | "image" | "file";
  at: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseIncoming(body: any): Incoming | null {
  const event: string = body?.event ?? "";
  if (event && !event.startsWith("message.")) return null;
  if (/ack|failed|revoked|reaction|edited/.test(event)) return null;
  const d = body?.data ?? body?.payload ?? body;
  const m = d?.message ?? d;
  const fromMe = !!(m?.fromMe ?? (event === "message.sent" || m?.direction === "outgoing"));
  const chatId: string = String(m?.chatId ?? (fromMe ? m?.to : m?.from) ?? "");
  if (!chatId || /@(newsletter|broadcast)$/.test(chatId) || ["channel", "status", "broadcast"].includes(m?.kind)) return null;
  const isGroup = !!m?.isGroup || chatId.endsWith("@g.us") || m?.kind === "group";
  const isLid = chatId.endsWith("@lid");
  // Groups are keyed by their group id; people by phone number
  const phone = isGroup ? chatId : String((isLid ? (m?.senderPhone ?? m?.contact?.number) : null) ?? chatId.split("@")[0]).replace(/[^\d]/g, "") || chatId;
  const type = String(m?.type ?? "text");
  const kind = type === "voice" || type === "audio" || type === "ptt" ? "voice" : type === "image" || type === "sticker" ? "image" : ["video", "document"].includes(type) ? "file" : "text";
  const ts = Number(m?.timestamp ?? body?.timestamp ?? 0);
  return {
    id: String(m?.id?._serialized ?? m?.id ?? m?.waMessageId ?? `${chatId}-${ts}`),
    sessionId: body?.sessionId ?? d?.sessionId ?? m?.sessionId ?? null,
    isGroup,
    author: String(m?.pushName ?? m?.notifyName ?? m?.senderName ?? m?.contact?.pushName ?? m?.contact?.pushname ?? m?.author ?? ""),
    senderId: fromMe ? "" : String((isGroup ? m?.author : m?.from) ?? ""),
    fromMe,
    phone,
    chatId,
    name: String((isGroup ? m?.chatName : null) ?? m?.pushName ?? m?.notifyName ?? m?.chatName ?? m?.contact?.pushname ?? m?.contact?.name ?? d?.contact?.name ?? phone),
    text: String(m?.body ?? m?.text ?? m?.caption ?? ""),
    kind,
    at: ts ? (ts < 1e12 ? ts * 1000 : ts) : Date.now(),
  };
}

// Phone number (digits) behind a sender id. Group senders can be hidden "@lid" ids; the gateway
// resolves those best-effort. Cached, since the same people write all day.
const phoneCache = new Map<string, string>();
export async function senderPhone(a: AccountWithSecret | null, id: string) {
  if (!id) return "";
  if (!id.endsWith("@lid")) return id.split("@")[0].replace(/[^\d]/g, "");
  const hit = phoneCache.get(id);
  if (hit !== undefined) return hit;
  let phone = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = a ? await wa<any>(a, `/contacts/${encodeURIComponent(id)}/phone`) : null;
    phone = String(r?.phone ?? r?.number ?? r?.data?.phone ?? "").replace(/[^\d]/g, "");
  } catch {
    /* unknown */
  }
  phoneCache.set(id, phone);
  return phone;
}

// ---------- History (the gateway keeps every message it has seen) ----------

export interface ChatInfo {
  id: string;
  name: string;
  isGroup: boolean;
  kind: string;
  at: number; // last activity (ms)
}

export async function listChats(a: AccountWithSecret): Promise<ChatInfo[]> {
  const out: ChatInfo[] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await wa<any>(a, `/chats?limit=500&offset=${offset}`);
    const list = Array.isArray(page) ? page : (page?.data ?? []);
    for (const c of list) {
      const id = String(c.id?._serialized ?? c.id);
      const ts = Number(c.timestamp ?? 0);
      out.push({ id, name: String(c.name ?? ""), isGroup: !!c.isGroup || id.endsWith("@g.us"), kind: String(c.kind ?? ""), at: ts < 1e12 ? ts * 1000 : ts });
    }
    if (list.length < 500) break;
  }
  return out;
}

// Every message the gateway stored since a moment, all chats, oldest first, in the webhook's shape.
// Walks newest → oldest with the keyset cursor (the gateway returns at most 100 per page).
export async function messagesSince(a: AccountWithSecret, since: number, onPage?: (n: number) => void): Promise<Incoming[]> {
  const out: Incoming[] = [];
  let after = "";
  for (let page = 0; page < 2000; page++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await wa<any>(a, `/messages?limit=100&inlineMedia=false${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    const list = Array.isArray(r) ? r : (r?.messages ?? r?.data ?? []);
    let older = false;
    for (const m of list) {
      const ts = Number(m.timestamp ?? 0) * (Number(m.timestamp) < 1e12 ? 1000 : 1);
      if (ts < since) {
        older = true;
        continue;
      }
      const inc = parseIncoming({
        event: m.direction === "outgoing" ? "message.sent" : "message.received",
        sessionId: a.config.sessionId,
        data: { ...m, id: m.waMessageId ?? m.id, fromMe: m.direction === "outgoing", isGroup: String(m.chatId).endsWith("@g.us") },
      });
      if (inc) out.push(inc);
    }
    onPage?.(out.length);
    if (older || !list.length) break;
    after = String(list[list.length - 1].id);
  }
  return out.reverse();
}

// ---------- Delivery ticks: sent → delivered → read ----------

export type Delivery = "sent" | "delivered" | "read" | "failed";
const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, played: 3, failed: 9 };

// The bare WhatsApp id ("3EB0…") inside any id form ("true_123@c.us_3EB0…")
export const bareId = (id: string) => String(id ?? "").split("_").pop() ?? "";

// A message.ack / message.failed webhook → { id, status }, or null for anything else
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAck(body: any): { id: string; status: Delivery } | null {
  const event: string = body?.event ?? "";
  if (event !== "message.ack" && event !== "message.failed") return null;
  const d = body?.data ?? body?.payload ?? {};
  const m = d?.message ?? d;
  const id = String(m?.id?._serialized ?? m?.id ?? m?.messageId ?? m?.waMessageId ?? "");
  if (!id) return null;
  if (event === "message.failed") return { id, status: "failed" };
  // Engines report either a name (sent/delivered/read/played) or a number (1 sent, 2 delivered, 3 read, 4 played)
  const raw = String(m?.status ?? m?.ackName ?? d?.ackName ?? m?.ack ?? d?.ack ?? "").toLowerCase();
  const n = Number(raw);
  const status: Delivery | null = /read|play/.test(raw) || n >= 3 ? "read" : /deliver|device/.test(raw) || n === 2 ? "delivered" : /sent|server/.test(raw) || n === 1 ? "sent" : /fail|error/.test(raw) || n < 0 ? "failed" : null;
  return status ? { id, status } : null;
}

// Only moves forward (a late "delivered" never overwrites "read")
export const isNewer = (current: string | null, next: string) =>
  next === "failed" ? current !== "read" && current !== "delivered" && current !== "failed" : current !== "failed" && (RANK[next] ?? 0) > (RANK[current ?? ""] ?? 0);

// Current status of recent messages in one chat, from the gateway's store (fallback when an ack event was missed)
export async function chatStatuses(a: AccountWithSecret, chatId: string, limit = 40) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await wa<any>(a, `/messages?chatId=${encodeURIComponent(chatId)}&limit=${limit}&inlineMedia=false`);
  const list = Array.isArray(r) ? r : (r?.messages ?? r?.data ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return list.filter((m: any) => m.direction === "outgoing").map((m: any) => ({ id: bareId(String(m.waMessageId ?? m.id)), status: String(m.status ?? "") }));
}

export const accountForSession = async (sessionId: string | null) => {
  const list = await waAccounts();
  return list.find((a) => a.config.sessionId === sessionId) ?? list[0] ?? null;
};

// Voice notes: the gateway stores the media; fetch the bytes and keep a local copy for playback.
export async function downloadMedia(inc: Incoming): Promise<{ file: string; mime: string; buf: Buffer } | null> {
  const a = await accountForSession(inc.sessionId);
  if (!a) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base(a)}/api/sessions/${a.config.sessionId}/messages/${encodeURIComponent(inc.chatId)}/${encodeURIComponent(inc.id)}/media`, {
      headers: { "x-api-key": a.secret },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get("content-type") ?? "audio/ogg").split(";")[0];
      const ext = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : "ogg";
      const file = `${inc.id.replace(/[^\w-]/g, "").slice(-60)}.${ext}`;
      fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
      return { file, mime: mime === "application/octet-stream" ? "audio/ogg" : mime, buf };
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); // media may still be downloading on the gateway
  }
  return null;
}

// ---------- Groups and contacts for the recipient picker ----------

export interface Target {
  id: string; // 123@g.us or 92300…@c.us
  name: string;
  number?: string;
}

const targetCache = new Map<string, { at: number; list: Target[] }>();

// Your WhatsApp groups or saved contacts, cached for 10 minutes (the group list takes a few seconds).
export async function listTargets(a: AccountWithSecret, type: "groups" | "contacts", refresh = false): Promise<Target[]> {
  const key = `${a.id}:${type}`;
  const hit = targetCache.get(key);
  if (!refresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.list;
  const out: Target[] = [];
  // The gateway's /groups call can take over 30 s; the chat list has the same groups and answers in a second
  if (type === "groups") {
    for (const c of await listChats(a)) if (c.isGroup) out.push({ id: c.id, name: c.name || "Unnamed group" });
    out.sort((x, y) => x.name.localeCompare(y.name));
    targetCache.set(key, { at: Date.now(), list: out });
    return out;
  }
  for (let offset = 0; offset < 20_000; offset += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await wa<any>(a, `/${type}?limit=1000&offset=${offset}`);
    const list = Array.isArray(page) ? page : (page?.data ?? []);
    for (const x of list) {
      if (String(x.id).endsWith("@c.us") && !x.isBlocked) out.push({ id: String(x.id), name: String(x.name || x.pushName || x.number || x.id), number: String(x.number ?? String(x.id).split("@")[0]) });
    }
    if (list.length < 1000) break;
  }
  out.sort((x, y) => x.name.localeCompare(y.name));
  targetCache.set(key, { at: Date.now(), list: out });
  return out;
}

// Restart a session after the gateway restarted, or fetch the QR code when it needs linking again.
export async function startSession(a: AccountWithSecret) {
  try {
    await wa(a, "/start", { method: "POST" });
  } catch (e) {
    if (!/already started/i.test(e instanceof Error ? e.message : "")) throw e;
  }
  return sessionStatus(a);
}

export async function sessionQr(a: AccountWithSecret) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await wa<any>(a, "/qr");
  return String(r?.qr ?? r?.qrCode ?? r?.data?.qr ?? r?.image ?? r?.base64 ?? "");
}
