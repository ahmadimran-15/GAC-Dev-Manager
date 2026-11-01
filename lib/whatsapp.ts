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

export async function sendWhatsApp(to: string, text: string, accountId?: string | null): Promise<{ ok: boolean; simulated?: boolean; id?: string; error?: string }> {
  const a = await pick(accountId);
  if (!a) return { ok: true, simulated: true };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await wa<any>(a, "/messages/send-text", { method: "POST", body: JSON.stringify({ chatId: chatIdFor(to), text }) });
    return { ok: true, id: String(r?.messageId ?? r?.waMessageId ?? r?.id ?? "") || undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "WhatsApp send failed" };
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
  const body = { url, events: ["message.received", "message.sent"], secret: process.env.WA_WEBHOOK_SECRET || undefined, retryCount: 3 };
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
    author: String(m?.pushName ?? m?.notifyName ?? m?.senderName ?? m?.contact?.pushname ?? m?.author ?? ""),
    fromMe,
    phone,
    chatId,
    name: String((isGroup ? m?.chatName : null) ?? m?.pushName ?? m?.notifyName ?? m?.chatName ?? m?.contact?.pushname ?? m?.contact?.name ?? d?.contact?.name ?? phone),
    text: String(m?.body ?? m?.text ?? m?.caption ?? ""),
    kind,
    at: ts ? (ts < 1e12 ? ts * 1000 : ts) : Date.now(),
  };
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
  for (let offset = 0; offset < 20_000; offset += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await wa<any>(a, `/${type}?limit=1000&offset=${offset}`);
    const list = Array.isArray(page) ? page : (page?.data ?? []);
    for (const x of list) {
      if (type === "groups") out.push({ id: String(x.id), name: String(x.name || x.subject || "Unnamed group") });
      else if (String(x.id).endsWith("@c.us") && !x.isBlocked) out.push({ id: String(x.id), name: String(x.name || x.pushName || x.number || x.id), number: String(x.number ?? String(x.id).split("@")[0]) });
    }
    if (list.length < 1000 || type === "groups") break;
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
