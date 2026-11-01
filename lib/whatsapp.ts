import fs from "fs";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";
import { MEDIA_DIR } from "@/lib/db";

// ChatSlash / OpenWA self-hosted WhatsApp gateway. Session and key come from .env.
const BASE = () => (process.env.WA_BASE_URL ?? "").replace(/\/$/, "");
const SESSION = () => process.env.WA_SESSION_ID ?? "";
const KEY = () => process.env.WA_API_KEY ?? "";

export const waConfigured = () => !!(BASE() && SESSION() && KEY());

async function wa<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE()}/api/sessions/${SESSION()}${p}`, {
    ...init,
    headers: { "x-api-key": KEY(), accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ? [data.message].flat().join(", ") : `WhatsApp gateway error ${res.status}`);
  return data as T;
}

const chatIdFor = (to: string) => (to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@c.us`);

export async function sendWhatsApp(to: string, text: string): Promise<{ ok: boolean; simulated?: boolean; id?: string; error?: string }> {
  if (!waConfigured()) return { ok: true, simulated: true };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await wa<any>("/messages/send-text", { method: "POST", body: JSON.stringify({ chatId: chatIdFor(to), text }) });
    return { ok: true, id: String(r?.messageId ?? r?.waMessageId ?? r?.id ?? "") || undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "WhatsApp send failed" };
  }
}

export async function sessionStatus() {
  if (!waConfigured()) return null;
  try {
    return await wa<{ status: string; phone: string; pushName: string }>("");
  } catch (e) {
    return { status: "error", phone: "", pushName: e instanceof Error ? e.message : "" };
  }
}

// Registers (or updates) this dashboard's webhook on the gateway. Other webhooks (e.g. n8n) are left alone.
export async function registerWebhook(url: string) {
  const body = { url, events: ["message.received", "message.sent"], secret: process.env.WA_WEBHOOK_SECRET || undefined, retryCount: 3 };
  const list = await wa<{ id: string; url: string }[]>("/webhooks");
  const mine = list.find((w) => w.url.includes("/api/webhooks/whatsapp"));
  if (mine) return wa(`/webhooks/${mine.id}`, { method: "PUT", body: JSON.stringify(body) });
  return wa("/webhooks", { method: "POST", body: JSON.stringify(body) });
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
  if (!chatId || m?.isGroup || /@(g\.us|newsletter|broadcast)$/.test(chatId) || ["group", "channel", "status", "broadcast"].includes(m?.kind)) return null;
  const isLid = chatId.endsWith("@lid");
  const phone = String((isLid ? (m?.senderPhone ?? m?.contact?.number) : null) ?? chatId.split("@")[0]).replace(/[^\d]/g, "") || chatId;
  const type = String(m?.type ?? "text");
  const kind = type === "voice" || type === "audio" || type === "ptt" ? "voice" : type === "image" || type === "sticker" ? "image" : ["video", "document"].includes(type) ? "file" : "text";
  const ts = Number(m?.timestamp ?? body?.timestamp ?? 0);
  return {
    id: String(m?.id?._serialized ?? m?.id ?? m?.waMessageId ?? `${chatId}-${ts}`),
    fromMe,
    phone,
    chatId,
    name: String(m?.pushName ?? m?.notifyName ?? m?.chatName ?? m?.contact?.pushname ?? m?.contact?.name ?? d?.contact?.name ?? phone),
    text: String(m?.body ?? m?.text ?? m?.caption ?? ""),
    kind,
    at: ts ? (ts < 1e12 ? ts * 1000 : ts) : Date.now(),
  };
}

// Voice notes: the gateway stores the media; fetch the bytes and keep a local copy for playback.
export async function downloadMedia(inc: Incoming): Promise<{ file: string; mime: string; buf: Buffer } | null> {
  if (!waConfigured()) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE()}/api/sessions/${SESSION()}/messages/${encodeURIComponent(inc.chatId)}/${encodeURIComponent(inc.id)}/media`, {
      headers: { "x-api-key": KEY() },
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
