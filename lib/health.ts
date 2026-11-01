import fs from "fs";
import path from "path";
import { DATA_DIR, get, kvGet, kvSet } from "@/lib/db";
import { aiConfigured, chat } from "@/lib/ai";
import { clickupConfigured } from "@/lib/clickup";
import { listAccounts } from "@/lib/accounts";
import { sessionStatus, waAccounts } from "@/lib/whatsapp";
import { sttLabel, whisperConfigured } from "@/lib/stt";

// Checks every connection on a timer so a broken key, a disconnected WhatsApp session or a dead
// mailbox shows up in the dashboard instead of failing silently.

export interface Check {
  key: string;
  group: "Core" | "WhatsApp" | "Email" | "AI";
  name: string;
  ok: boolean | null; // null = not set up
  detail: string;
  action?: "wa-start" | "wa-qr" | "settings";
  accountId?: string;
  ms?: number;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} didn't answer within ${ms / 1000}s`)), ms))]);

async function timed(fn: () => Promise<string>, ms = 30_000, label = "Service"): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now();
  try {
    const detail = await withTimeout(fn(), ms, label);
    return { ok: true, detail, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

export async function runHealth(): Promise<{ at: number; checks: Check[] }> {
  const checks: Check[] = [];
  const tasks: Promise<void>[] = [];

  tasks.push(
    timed(async () => {
      await get("select 1 as ok");
      return process.env.DATABASE_HOST ? "Supabase is reachable" : "Local database file";
    }, 15_000, "Database").then((r) => void checks.push({ key: "db", group: "Core", name: "Database", ...r })),
  );

  tasks.push(
    aiConfigured()
      ? timed(async () => {
          const out = await chat("Reply with exactly the word OK.", "health");
          if (!/ok/i.test(out)) throw new Error(`Unexpected answer: ${out.slice(0, 80)}`);
          return `${process.env.GEMINI_MODEL} answered`;
        }, 60_000, "Gemini").then((r) => void checks.push({ key: "gemini", group: "AI", name: "Gemini", ...r, detail: r.ok ? r.detail : `Not working: ${r.detail}. Check GEMINI_API_KEY / the custom server.` }))
      : Promise.resolve(void checks.push({ key: "gemini", group: "AI", name: "Gemini", ok: null, detail: "Not set up (GEMINI_BASE_URL / GEMINI_API_KEY)" })),
  );

  tasks.push(
    clickupConfigured()
      ? timed(async () => {
          const res = await fetch("https://api.clickup.com/api/v2/team", { headers: { Authorization: process.env.CLICKUP_TOKEN! }, signal: AbortSignal.timeout(20_000) });
          const j = await res.json().catch(() => null);
          if (!res.ok) throw new Error(j?.err ?? `HTTP ${res.status}`);
          return `Workspace "${j.teams?.[0]?.name ?? "?"}"`;
        }, 25_000, "ClickUp").then((r) => void checks.push({ key: "clickup", group: "Core", name: "ClickUp", ...r, detail: r.ok ? r.detail : `API key not working: ${r.detail}` }))
      : Promise.resolve(void checks.push({ key: "clickup", group: "Core", name: "ClickUp", ok: null, detail: "Not set up (CLICKUP_TOKEN)" })),
  );

  tasks.push(
    (async () => {
      for (const a of await waAccounts()) {
        const st = await sessionStatus(a);
        const label = `${a.label}${/^\d+$/.test(a.address) ? ` · +${a.address}` : ""}`;
        if (st.status === "ready") checks.push({ key: `wa:${a.id}`, group: "WhatsApp", name: label, ok: true, detail: "Connected", accountId: a.id });
        else if (st.status === "error")
          checks.push({ key: `wa:${a.id}`, group: "WhatsApp", name: label, ok: false, detail: `Gateway not reachable: ${st.pushName || "no answer"}. Is the WhatsApp server running?`, accountId: a.id });
        else if (/qr|scan|pair|auth/i.test(st.status))
          checks.push({ key: `wa:${a.id}`, group: "WhatsApp", name: label, ok: false, detail: "Needs to be linked again: scan the QR code with WhatsApp on your phone", action: "wa-qr", accountId: a.id });
        else checks.push({ key: `wa:${a.id}`, group: "WhatsApp", name: label, ok: false, detail: `Session ${st.status}. Start it again to receive messages.`, action: "wa-start", accountId: a.id });
      }
    })(),
  );

  tasks.push(
    (async () => {
      for (const a of await listAccounts("email")) {
        if (!a.enabled) checks.push({ key: `em:${a.id}`, group: "Email", name: a.address, ok: null, detail: "Paused", action: "settings", accountId: a.id });
        else if (!a.status) checks.push({ key: `em:${a.id}`, group: "Email", name: a.address, ok: null, detail: "Not checked yet", accountId: a.id });
        else
          checks.push({
            key: `em:${a.id}`,
            group: "Email",
            name: a.address,
            ok: a.status.ok,
            detail: a.status.ok ? (a.status.error ? `Reading OK · ${a.status.error}` : "Reading and sending OK") : `Can't sign in: ${a.status.error}. Re-add it with the right password.`,
            action: a.status.ok ? undefined : "settings",
            accountId: a.id,
          });
      }
    })(),
  );

  tasks.push(
    (async () => {
      if (!whisperConfigured()) return void checks.push({ key: "stt", group: "AI", name: "Speech to text", ok: null, detail: "Off" });
      if ((process.env.STT_PROVIDER || "local") === "api") return void checks.push({ key: "stt", group: "AI", name: "Speech to text", ok: true, detail: sttLabel() });
      const models = path.join(DATA_DIR, "models");
      const has = fs.existsSync(models) && fs.readdirSync(models, { recursive: true }).some((f) => String(f).includes("whisper"));
      checks.push({ key: "stt", group: "AI", name: "Speech to text", ok: true, detail: `${sttLabel()} · ${has ? "model downloaded" : "model downloads on first voice note"}` });
    })(),
  );

  tasks.push(
    (async () => {
      const url = process.env.PUBLIC_URL;
      if (!url) return void checks.push({ key: "webhook", group: "Core", name: "Public address (webhooks)", ok: null, detail: "PUBLIC_URL not set: WhatsApp can't deliver incoming messages" });
      const r = await timed(async () => {
        const res = await fetch(`${url.replace(/\/$/, "")}/api/webhooks/whatsapp`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return url;
      }, 20_000, "Public address");
      checks.push({ key: "webhook", group: "Core", name: "Public address (webhooks)", ...r, detail: r.ok ? `${url} is reachable` : `${url} is not reachable (${r.detail}). Restart the tunnel or check the domain.` });
    })(),
  );

  await Promise.allSettled(tasks);
  const order = ["Core", "WhatsApp", "Email", "AI"];
  checks.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const result = { at: Date.now(), checks };
  await kvSet("health", JSON.stringify(result)).catch(() => {});
  return result;
}

export async function lastHealth(): Promise<{ at: number; checks: Check[] } | null> {
  try {
    return JSON.parse((await kvGet("health")) ?? "null");
  } catch {
    return null;
  }
}
