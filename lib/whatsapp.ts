import fs from "fs";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";
import { MEDIA_DIR, get, kvGet, kvSet } from "@/lib/db";
import { accountsWithSecrets, getAccount, type AccountWithSecret } from "@/lib/accounts";
import { teamNumbers } from "@/lib/team-numbers";

// ChatSlash / OpenWA self-hosted WhatsApp gateway. Each WhatsApp number is an account (session) added in Settings.

const base = (a: AccountWithSecret) => (a.config.baseUrl ?? "").replace(/\/$/, "");

class GatewayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function wa<T>(a: AccountWithSecret, p: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(`${base(a)}/api/sessions/${a.config.sessionId}${p}`, {
    ...init,
    headers: { "x-api-key": a.secret, accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  const msg = data?.message ?? data?.error?.message; // the gateway uses both shapes
  if (!res.ok) throw new GatewayError(msg ? [msg].flat().join(", ") : `WhatsApp gateway error ${res.status}`, res.status);
  return data as T;
}

export const waAccounts = () => accountsWithSecrets("whatsapp");
export const waConfigured = async () => (await waAccounts()).length > 0;
const pick = async (id?: string | null) => (id ? await getAccount(id) : null) ?? (await waAccounts()).find((a) => a.canSend) ?? null;

const chatIdFor = (to: string) => (to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@c.us`);

// One send = ONE request, like a plain curl to send-text. Never re-sent automatically: a slow gateway may still
// deliver after we stop waiting, and re-sending made duplicates. The only retry is when the gateway clearly
// REJECTS the quote (4xx = nothing was sent); then it goes once without the quote.
// opts.quotedMessageId makes it a reply; opts.mentions = ["923…@c.us"] (the text must contain "@923…").
export async function sendWhatsApp(
  to: string,
  text: string,
  accountId?: string | null,
  opts: { quotedMessageId?: string | null; mentions?: string[] } = {},
): Promise<{ ok: boolean; simulated?: boolean; id?: string; error?: string; quoted?: boolean; uncertain?: boolean }> {
  const a = await pick(accountId);
  if (!a) return { ok: true, simulated: true };
  const body = { chatId: chatIdFor(to), text, ...(opts.mentions?.length ? { mentions: opts.mentions } : {}) };
  const sendOnce = async (quoted?: string | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await wa<any>(a, "/messages/send-text", { method: "POST", body: JSON.stringify(quoted ? { ...body, quotedMessageId: quoted } : body) }, 120_000);
    return String(r?.messageId ?? r?.waMessageId ?? r?.id ?? "") || undefined;
  };
  try {
    return { ok: true, id: await sendOnce(opts.quotedMessageId), quoted: !!opts.quotedMessageId };
  } catch (e) {
    if (opts.quotedMessageId && e instanceof GatewayError && e.status >= 400 && e.status < 500) {
      try {
        return { ok: true, id: await sendOnce(), quoted: false };
      } catch (e2) {
        return { ok: false, error: e2 instanceof Error ? e2.message : "WhatsApp send failed" };
      }
    }
    // Timeout / gateway down: it may still go out, so don't retry; tell the user to check before re-sending
    if (!(e instanceof GatewayError)) return { ok: false, uncertain: true, error: "WhatsApp is slow to confirm. It may still be delivered: check the chat before sending again." };
    return { ok: false, error: e.message };
  }
}

type Person = { name: string; number: string };

// Edit distance, for spoken or misspelt names ("@Tulayb", "@TuLab" → Tulaib)
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Capitalised words that are also first names; never tagged without an "@"
const NOT_NAMES = new Set(["will", "mark", "may", "hope", "grace", "faith", "joy", "bill", "team", "admin", "dev", "support", "sales", "office", "client", "manager"]);

// "@Tulaib please check" → text "@92300… please check" + mentions ["92300…@c.us"] (what WhatsApp needs),
// display "@Tulaib please check" (what we store and show). Full names, then unique first names, then
// (only among `close`, e.g. a group's members) the one nearest spelling. missed = "@Name"s nobody matched.
// In a group (`close` given) a member's first name written without "@" ("Tulaib please check") is tagged too.
export async function resolveMentions(text: string, people: Person[], close: Person[] = []) {
  const none = { text, display: text, mentions: [] as string[], missed: [] as string[], tagged: [] as string[] };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = (n: string) => n.split(/\s+/)[0];
  const tagged = new Set<string>();
  let out = text;
  let display = text;
  // "tag tulaib" / "mention Tulaib" typed straight into the reply → "@tulaib" (matched below), when that's a member
  const near = (w: string) => close.some((p) => distance(w.toLowerCase(), first(p.name).toLowerCase()) <= (w.length >= 6 ? 2 : 1));
  const asTag = (s: string) => s.replace(/(?<![\p{L}\p{N}_])(?:tag|mention)\s+@?(\p{L}{3,})/giu, (m, w: string) => (near(w) ? `@${w}` : m));
  out = asTag(out);
  display = asTag(display);
  // Plain names: unique first names of group members, written capitalised as a whole word, first time only
  const counts = new Map<string, Set<string>>();
  for (const p of close) counts.set(first(p.name).toLowerCase(), (counts.get(first(p.name).toLowerCase()) ?? new Set()).add(p.number));
  for (const p of close) {
    const f = first(p.name);
    if (f.length < 4 || NOT_NAMES.has(f.toLowerCase()) || counts.get(f.toLowerCase())!.size > 1 || !/^\p{L}+$/u.test(f)) continue;
    // "Tulaib" / "TULAIB" but not "tulaib" inside a sentence, and not "@Tulaib" (handled below)
    const pat = `${f[0].toUpperCase()}${[...f.slice(1)].map((ch) => `[${ch.toLowerCase()}${ch.toUpperCase()}]`).join("")}`;
    const re = new RegExp(`(?<![@\\p{L}\\p{N}_])${pat}(?![\\p{L}\\p{N}_])`, "u");
    if (re.test(out)) {
      out = out.replace(re, `@${p.number}`);
      display = display.replace(re, `@${f}`);
      tagged.add(f);
    }
  }
  if (!out.includes("@")) return none;
  const mentions = new Set<string>([...tagged].map((f) => `${close.find((p) => first(p.name) === f)!.number}@c.us`));
  // Longest names first so "@Muhammad Ali" wins over "@Muhammad"; then unique first names
  const firsts = new Map<string, Person[]>();
  for (const p of people) {
    const f = first(p.name).toLowerCase();
    if (!(firsts.get(f) ?? []).some((x) => x.number === p.number)) firsts.set(f, [...(firsts.get(f) ?? []), p]);
  }
  const candidates = [
    ...[...people].sort((x, y) => y.name.length - x.name.length).map((p) => ({ token: p.name, p })),
    ...[...firsts].filter(([, l]) => l.length === 1).map(([f, l]) => ({ token: f, p: l[0] })),
  ].filter((c) => c.token.length >= 3 && c.p.number);
  for (const c of candidates) {
    const re = new RegExp(`@${esc(c.token)}(?![\\p{L}\\p{N}])`, "giu");
    if (re.test(out)) {
      out = out.replace(re, `@${c.p.number}`);
      display = display.replace(re, `@${first(c.p.name)}`);
      mentions.add(`${c.p.number}@c.us`);
      tagged.add(first(c.p.name));
    }
  }
  // Whatever is left: nearest first name among the close people, if exactly one is near enough
  const missed: string[] = [];
  // (an "@" inside a word is an email address, not a tag)
  for (const m of [...out.matchAll(/(?<![\p{L}\p{N}_.])@(\p{L}[\p{L}\p{N}_]{1,})/gu)]) {
    const token = m[1].toLowerCase();
    const scored = close
      .map((p) => ({ p, d: distance(token, first(p.name).toLowerCase()) }))
      .filter((x) => x.d <= (token.length >= 6 ? 2 : 1))
      .sort((x, y) => x.d - y.d);
    const best = scored.filter((x) => x.d === scored[0]?.d);
    if (token.length >= 3 && best.length && best.every((x) => x.p.number === best[0].p.number)) {
      const re = new RegExp(`@${esc(m[1])}(?![\\p{L}\\p{N}])`, "gu");
      out = out.replace(re, `@${best[0].p.number}`);
      display = display.replace(re, `@${first(best[0].p.name)}`);
      mentions.add(`${best[0].p.number}@c.us`);
      tagged.add(first(best[0].p.name));
    } else missed.push(m[1]);
  }
  return { text: out, display, mentions: [...mentions], missed: [...new Set(missed)], tagged: [...tagged] };
}

// Phone numbers of a group's members (for mentions). The gateway takes ~30 s to list them, so the list is
// cached for 30 min and refreshed in the background; waitMs = how long a caller may wait when nothing is cached.
// null = not known (yet).
const memberCache = new Map<string, { at: number; list: string[] }>();
const memberLoads = new Map<string, Promise<string[] | null>>();
function loadMembers(a: AccountWithSecret, groupId: string) {
  let p = memberLoads.get(groupId);
  if (!p) {
    p = (async () => {
      try {
        const get = () => wa<any>(a, `/groups/${encodeURIComponent(groupId)}`, undefined, 90_000); // eslint-disable-line @typescript-eslint/no-explicit-any
        const g = await get().catch(get); // one retry: the gateway sometimes drops a call when busy
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list: any[] = g?.participants ?? g?.data?.participants ?? [];
        const out = list.map((x) => String(x?.number ?? x?.phone ?? x?.id?._serialized ?? x?.id ?? "").split("@")[0].replace(/[^\d]/g, "")).filter(Boolean);
        memberCache.set(groupId, { at: Date.now(), list: out });
        return out;
      } catch {
        return null;
      } finally {
        memberLoads.delete(groupId);
      }
    })();
    memberLoads.set(groupId, p);
  }
  return p;
}
export async function groupMembers(a: AccountWithSecret, groupId: string, waitMs = 0): Promise<string[] | null> {
  const hit = memberCache.get(groupId);
  if (hit) {
    if (Date.now() - hit.at > 30 * 60_000) loadMembers(a, groupId);
    return hit.list;
  }
  const load = loadMembers(a, groupId);
  return waitMs ? Promise.race([load, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]) : null;
}

// Phone number → name (saved contacts and team numbers), for showing "@923…" mentions and "+923…" senders as
// names. Uses the cached contact list only (starts loading it if it isn't there yet), so it never slows a page.
export async function numberNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const a of await waAccounts()) {
    await loadSavedContacts(a);
    const list = contactCache(a);
    if (!list || !targetCache.get(`${a.id}:contacts`)?.at) listTargets(a, "contacts").catch(() => {});
    for (const t of list ?? []) if (t.number && t.name && !/^\+?\d+$/.test(t.name)) names.set(t.number, t.name);
  }
  for (const t of await teamNumbers()) names.set(t.number, t.name);
  // Mentions carrying a LID rather than a phone number, learned when a chat was opened.
  for (const [lid, n] of Object.entries(await knownLidNames())) names.set(lid, n);
  // Your own WhatsApp numbers are tagged by teammates too: show your name
  const owner = (await get<{ name: string }>("select name from users where role = 'admin' order by created_at limit 1").catch(() => null))?.name;
  for (const a of await waAccounts()) if (owner && a.address && /^\d+$/.test(a.address)) names.set(a.address, owner);
  return names;
}

// "@923074061626" → "@Tulaib Get AI Chatbots", "+923…: hi" → "Tulaib…: hi". hideUnknown (team views) turns
// numbers nobody is saved under into "someone", so a phone number is never shown.
// A number typed inside a message ("call me on +92…") is left as it is.
export function withNames(text: string, names: Map<string, string>, hideUnknown = false) {
  const name = (num: string) => names.get(num) ?? (hideUnknown ? "someone" : null);
  return text
    .replace(/^\+(\d{8,15}): /, (m, num: string) => (name(num) ? `${name(num)}: ` : m))
    // Up to 20 digits: a mention can carry WhatsApp's own id for someone (a "LID") rather than their
    // phone number, and those are longer. @56694222667797 is a person, not a phone number.
    .replace(/(^|[^\w@])@(\d{8,20})(?!\d)/g, (m, pre: string, num: string) => (name(num) ? `${pre}@${name(num)}` : m));
}

// Who "@Name" can mean in a chat: saved contacts and team numbers. In a group, `close` = the ones who are
// members (only they get tagged, so a client group never sees a stranger's number), or null if unknown.
export async function taggablePeople(a: AccountWithSecret, chatId: string, waitMs = 0): Promise<{ people: Person[]; close: Person[] | null }> {
  const contacts = await Promise.race([listTargets(a, "contacts").catch(() => [] as Target[]), new Promise<Target[]>((r) => setTimeout(() => r(contactCache(a) ?? []), Math.max(waitMs, 1)))]);
  const people = [...(await teamNumbers()), ...contacts.map((t) => ({ name: t.name, number: t.number ?? "" }))].filter((p) => p.number && p.name && !/^\+?\d+$/.test(p.name));
  if (!chatId.endsWith("@g.us")) return { people, close: people };
  const members = await groupMembers(a, chatId, waitMs);
  if (!members) return { people, close: null };
  const set = new Set(members);
  const close = people.filter((p) => set.has(p.number));
  return { people: close, close };
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
  kind: "text" | "voice" | "image" | "video" | "file";
  // The gateway stamps every delivery with msg_<session>_<messageId>_<uuid>. The uuid is the same
  // for both halves of a photo sent in HD — two message ids, one actual send — so it is what tells
  // the second copy apart from a genuinely new picture.
  event?: string | null;
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
  // Video is its own kind now, so the thread can play it instead of calling it a file
  const kind = type === "voice" || type === "audio" || type === "ptt" ? "voice" : type === "image" || type === "sticker" ? "image" : type === "video" ? "video" : type === "document" ? "file" : "text";
  const ts = Number(m?.timestamp ?? body?.timestamp ?? 0);
  const idem = String(body?.idempotencyKey ?? "");
  const eventId = idem.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)?.[1] ?? null;
  return {
    id: String(m?.id?._serialized ?? m?.id ?? m?.waMessageId ?? `${chatId}-${ts}`),
    event: eventId,
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
export async function downloadMedia(inc: Incoming) {
  const a = await accountForSession(inc.sessionId);
  return a ? fetchMedia(a, inc.chatId, inc.id) : null;
}

// The same download for a message already in the inbox, from what we stored about it. Used by the
// Transcribe button, so a voice note is only ever fetched when you actually ask for it.
export async function downloadStoredMedia(account: string, chatId: string, messageId: string) {
  const list = await waAccounts();
  const a = list.find((x) => x.id === account || x.config.sessionId === account) ?? list[0];
  return a ? fetchMedia(a, chatId, messageId) : null;
}

// The gateway sends the file back with an audio content-type but, on this version, the body is its
// NestJS StreamableFile serialised to JSON, with the real bytes inside stream._readableState.buffer.
// Anything that already looks like a file is passed straight through.
function unwrap(buf: Buffer): Buffer {
  if (buf[0] !== 0x7b) return buf; // not "{": already the file itself
  try {
    const o = JSON.parse(buf.toString("utf8")) as { stream?: { _readableState?: { buffer?: ({ data?: number[] } | number[])[] } }; data?: number[] };
    const chunks = o.stream?._readableState?.buffer;
    if (Array.isArray(chunks) && chunks.length) return Buffer.concat(chunks.map((c) => Buffer.from(Array.isArray(c) ? c : (c.data ?? []))));
    if (Array.isArray(o.data)) return Buffer.from(o.data);
  } catch {
    /* not JSON after all: use it as it came */
  }
  return buf;
}

async function fetchMedia(a: AccountWithSecret, chatId: string, messageId: string): Promise<{ file: string; mime: string; buf: Buffer } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base(a)}/api/sessions/${a.config.sessionId}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/media`, {
      headers: { "x-api-key": a.secret },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const buf = unwrap(Buffer.from(await res.arrayBuffer()));
      const mime = (res.headers.get("content-type") ?? "audio/ogg").split(";")[0];
      // The saved name carries the right extension for pictures and video too, not just audio: the
      // file used to be written as .ogg whatever it was.
      const ext =
        mime.startsWith("image/") ? (mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg")
        : mime.startsWith("video/") ? (mime.includes("quicktime") ? "mov" : mime.includes("webm") ? "webm" : "mp4")
        : mime.includes("pdf") ? "pdf"
        : mime.includes("mpeg") ? "mp3"
        : mime.includes("mp4") || mime.includes("m4a") ? "m4a"
        : mime.includes("wav") ? "wav"
        : "ogg";
      const file = `${messageId.replace(/[^\w-]/g, "").slice(-60)}.${ext}`;
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
const targetLoads = new Map<string, Promise<Target[]>>();
const targetFailed = new Map<string, number>();
const contactCache = (a: AccountWithSecret) => targetCache.get(`${a.id}:contacts`)?.list ?? null;

// Your WhatsApp groups or saved contacts. Cached: after 10 minutes the old list is still answered at once
// while a fresh one loads in the background (the contact list takes several seconds).
export async function listTargets(a: AccountWithSecret, type: "groups" | "contacts", refresh = false): Promise<Target[]> {
  const key = `${a.id}:${type}`;
  if (type === "contacts") await loadSavedContacts(a);
  const hit = targetCache.get(key);
  if (!refresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.list;
  // WhatsApp down or reconnecting: keep answering with the saved list, try again after 2 minutes
  if (!refresh && hit && Date.now() - (targetFailed.get(key) ?? 0) < 2 * 60_000) return hit.list;
  let load = targetLoads.get(key);
  if (!load) {
    load = fetchTargets(a, type)
      .catch(() => fetchTargets(a, type)) // one retry: the gateway sometimes drops a call when busy
      .catch((e) => {
        targetFailed.set(key, Date.now());
        throw e;
      })
      .finally(() => targetLoads.delete(key));
    targetLoads.set(key, load);
  }
  if (!refresh && hit) {
    load.catch(() => {});
    return hit.list;
  }
  return load;
}

async function fetchTargets(a: AccountWithSecret, type: "groups" | "contacts"): Promise<Target[]> {
  const key = `${a.id}:${type}`;
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
  // Kept in the database too, so names show at once after a restart or while WhatsApp reconnects
  if (type === "contacts" && out.length) kvSet(`wa_contacts:${a.id}`, JSON.stringify(out.map((t) => [t.number, t.name]))).catch(() => {});
  return out;
}

// The contact list saved last time (used until a fresh one loads)
const savedTried = new Set<string>();
async function loadSavedContacts(a: AccountWithSecret) {
  const key = `${a.id}:contacts`;
  if (targetCache.has(key) || savedTried.has(key)) return;
  savedTried.add(key);
  try {
    const rows: [string, string][] = JSON.parse((await kvGet(`wa_contacts:${a.id}`)) ?? "[]");
    if (rows.length && !targetCache.has(key)) targetCache.set(key, { at: 0, list: rows.map(([number, name]) => ({ id: `${number}@c.us`, name, number })) });
  } catch {
    /* none saved */
  }
}

// Restart a session after the gateway restarted, or fetch the QR code when it needs linking again.
// A session stuck in "initializing" says "already started": then it's stopped and started again (stop only
// disconnects; it never unlinks the phone).
export async function startSession(a: AccountWithSecret) {
  try {
    await wa(a, "/start", { method: "POST" });
  } catch (e) {
    if (!/already started/i.test(e instanceof Error ? e.message : "")) throw e;
    if ((await sessionStatus(a)).status !== "ready") {
      await wa(a, "/stop", { method: "POST" });
      await new Promise((r) => setTimeout(r, 3000));
      await wa(a, "/start", { method: "POST" });
    }
  }
  // Give it a moment to connect before reporting
  for (let i = 0; i < 6; i++) {
    const st = await sessionStatus(a);
    if (st.status !== "initializing") return st;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return sessionStatus(a);
}

export async function sessionQr(a: AccountWithSecret) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await wa<any>(a, "/qr");
  return String(r?.qr ?? r?.qrCode ?? r?.data?.qr ?? r?.image ?? r?.base64 ?? "");
}

// ---------- Media out, and reactions ----------

// The gateway takes the file itself as base64 with its mime type, so nothing has to be hosted
// anywhere public first. One request, like send-text: never re-sent on a timeout, because a slow
// answer is not the same as a failed send and a retry used to double-post.
export async function sendWhatsAppMedia(
  accountId: string | null | undefined,
  to: string,
  file: { buf: Buffer; mime: string; name?: string },
  opts: { caption?: string; quotedMessageId?: string | null } = {},
): Promise<{ ok: boolean; simulated?: boolean; id?: string; error?: string; uncertain?: boolean }> {
  const a = await pick(accountId);
  if (!a) return { ok: true, simulated: true };
  const route = file.mime.startsWith("image/") && !file.mime.includes("svg") ? "send-image" : file.mime.startsWith("video/") ? "send-video" : file.mime.startsWith("audio/") ? "send-audio" : "send-document";
  const body = {
    chatId: chatIdFor(to),
    base64: file.buf.toString("base64"),
    mimetype: file.mime,
    filename: file.name || "file",
    ...(opts.caption ? { caption: opts.caption } : {}),
    ...(opts.quotedMessageId ? { quotedMessageId: opts.quotedMessageId } : {}),
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await wa<any>(a, `/messages/${route}`, { method: "POST", body: JSON.stringify(body) }, 180_000);
    return { ok: true, id: String(r?.messageId ?? r?.waMessageId ?? r?.id ?? "") || undefined };
  } catch (e) {
    if (!(e instanceof GatewayError)) return { ok: false, uncertain: true, error: "WhatsApp is slow to confirm. It may still have gone: check the chat before sending again." };
    return { ok: false, error: e.message };
  }
}

// Add or remove a reaction. An empty emoji takes ours off again.
export async function reactWhatsApp(accountId: string | null | undefined, chatId: string, messageId: string, emoji: string) {
  const a = await pick(accountId);
  if (!a) return { ok: true as const, simulated: true as const };
  try {
    await wa(a, "/messages/react", { method: "POST", body: JSON.stringify({ chatId: chatIdFor(chatId), messageId, emoji }) }, 60_000);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Could not react" };
  }
}

// Is our webhook actually on this session, pointing where it should? A number with no webhook looks
// perfectly healthy — connected, session ready — and simply never delivers a message, which is the
// worst way for this to fail. Checked on a timer so it cannot stay broken quietly.
export async function webhookHealth(a: AccountWithSecret, want: string) {
  const list = await wa<{ id: string; url: string }[]>(a, "/webhooks");
  const mine = list.find((w) => w.url.includes("/api/webhooks/whatsapp"));
  return { ok: !!mine && mine.url === want, found: mine?.url ?? null, others: list.filter((w) => !w.url.includes("/api/webhooks/whatsapp")).length };
}

// Mentions that carry a LID instead of a phone number.
//
// WhatsApp increasingly tags people by its own id — "@56694222667797" — which is not a phone number
// and so matches nothing in the contact list. The gateway can turn one into a phone number, and from
// there the usual contact name applies. The answer is kept in the database, because the same handful
// of people are tagged over and over and the lookup is a request to the gateway each time.
const LID_NAMES = "lid_names";

export async function knownLidNames(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await kvGet(LID_NAMES)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

// Fills in any @id in these texts that the names map cannot explain yet, and remembers what it finds.
export async function learnMentionNames(texts: string[], names: Map<string, string>, a: AccountWithSecret | null, max = 12) {
  const unknown = new Set<string>();
  for (const t of texts) for (const m of String(t ?? "").matchAll(/@(\d{8,20})/g)) if (!names.has(m[1])) unknown.add(m[1]);
  if (!unknown.size) return names;

  const saved = await knownLidNames();
  let learned = false;
  for (const lid of [...unknown].slice(0, max)) {
    if (saved[lid]) {
      names.set(lid, saved[lid]);
      continue;
    }
    if (!a) continue;
    const phone = await senderPhone(a, `${lid}@lid`).catch(() => "");
    if (!phone) continue;
    const name = names.get(phone);
    if (name) {
      // Only a real name is remembered. A number shown because nobody has saved that contact yet
      // would otherwise stick around after they are added to the address book.
      saved[lid] = name;
      names.set(lid, name);
      learned = true;
    } else {
      names.set(lid, `+${phone}`);
    }
  }
  if (learned) await kvSet(LID_NAMES, JSON.stringify(saved)).catch(() => {});
  return names;
}
