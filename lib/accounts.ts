import { all, get, kvGet, kvSet, run, uid } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

// Every place clients can reach the company: mailboxes (yours, info@, dev@, each teammate's) and
// WhatsApp numbers. Added from Settings; passwords and keys are stored encrypted.

export type AccountKind = "email" | "whatsapp";

export interface AccountConfig {
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  username?: string;
  baseUrl?: string;
  sessionId?: string;
}

export interface Account {
  id: string;
  kind: AccountKind;
  label: string;
  address: string; // email address or WhatsApp number
  provider: string;
  config: AccountConfig;
  enabled: boolean;
  canSend: boolean;
  status: { ok: boolean; at: number; error?: string } | null;
  createdAt: number;
}

export interface AccountWithSecret extends Account {
  secret: string;
}

export const EMAIL_PRESETS: Record<string, { label: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; note?: string }> = {
  titan: { label: "Titan", imapHost: "imap.titan.email", imapPort: 993, smtpHost: "smtp.titan.email", smtpPort: 465 },
  gmail: { label: "Gmail", imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465, note: "Needs an App Password (Google account → Security → 2-Step Verification → App passwords)." },
  zoho: { label: "Zoho", imapHost: "imap.zoho.com", imapPort: 993, smtpHost: "smtp.zoho.com", smtpPort: 465 },
  outlook: { label: "Outlook / Microsoft 365", imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587, note: "Microsoft blocks password login on most accounts. If the test fails, this mailbox needs 'Sign in with Microsoft' (coming next)." },
  yahoo: { label: "Yahoo", imapHost: "imap.mail.yahoo.com", imapPort: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, note: "Needs an app password." },
  custom: { label: "Other (IMAP/SMTP)", imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 465 },
};

interface Row {
  id: string;
  kind: AccountKind;
  label: string;
  address: string;
  provider: string;
  config: string;
  secret: string;
  enabled: number;
  can_send: number;
  status: string | null;
  created_at: number;
}

const toAccount = (r: Row): Account => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  address: r.address,
  provider: r.provider,
  config: JSON.parse(r.config || "{}"),
  enabled: !!r.enabled,
  canSend: !!r.can_send,
  status: r.status ? JSON.parse(r.status) : null,
  createdAt: r.created_at,
});

function withSecret(r: Row): AccountWithSecret {
  let secret = "";
  try {
    secret = decrypt(r.secret);
  } catch {
    /* key changed: account must be re-entered */
  }
  return { ...toAccount(r), secret };
}

export function listAccounts(kind?: AccountKind): Account[] {
  importFromEnv();
  const rows = kind ? all<Row>("select * from accounts where kind = ? order by created_at", kind) : all<Row>("select * from accounts order by kind, created_at");
  return rows.map(toAccount);
}

export function accountsWithSecrets(kind: AccountKind, onlyEnabled = true): AccountWithSecret[] {
  importFromEnv();
  return all<Row>(`select * from accounts where kind = ? ${onlyEnabled ? "and enabled = 1" : ""} order by created_at`, kind).map(withSecret);
}

export function getAccount(id: string): AccountWithSecret | null {
  const r = get<Row>("select * from accounts where id = ?", id);
  return r ? withSecret(r) : null;
}

export function findAccountByAddress(kind: AccountKind, address: string) {
  const r = get<Row>("select * from accounts where kind = ? and lower(address) = lower(?)", kind, address);
  return r ? withSecret(r) : null;
}

export function addAccount(a: { kind: AccountKind; label: string; address: string; provider: string; config: AccountConfig; secret: string; canSend?: boolean }) {
  const existing = get<{ id: string }>("select id from accounts where kind = ? and lower(address) = lower(?)", a.kind, a.address);
  if (existing) {
    run("update accounts set label = ?, provider = ?, config = ?, secret = ?, can_send = ?, enabled = 1 where id = ?", a.label, a.provider, JSON.stringify(a.config), encrypt(a.secret), a.canSend === false ? 0 : 1, existing.id);
    return existing.id;
  }
  const id = uid(a.kind === "email" ? "em_" : "wa_");
  run(
    "insert into accounts (id, kind, label, address, provider, config, secret, can_send, created_at) values (?,?,?,?,?,?,?,?,?)",
    id, a.kind, a.label, a.address.trim(), a.provider, JSON.stringify(a.config), encrypt(a.secret), a.canSend === false ? 0 : 1, Date.now(),
  );
  return id;
}

export function updateAccount(id: string, f: { label?: string; enabled?: boolean; canSend?: boolean }) {
  if (f.label !== undefined) run("update accounts set label = ? where id = ?", f.label, id);
  if (f.enabled !== undefined) run("update accounts set enabled = ? where id = ?", f.enabled ? 1 : 0, id);
  if (f.canSend !== undefined) run("update accounts set can_send = ? where id = ?", f.canSend ? 1 : 0, id);
}

export const deleteAccount = (id: string) => run("delete from accounts where id = ?", id);

// WhatsApp numbers imported from .env start with the session id; swap in the real phone number once known
export const setAccountAddress = (id: string, address: string) => run("update accounts set address = ? where id = ?", address, id);

export function setAccountStatus(id: string, ok: boolean, error?: string) {
  run("update accounts set status = ? where id = ?", JSON.stringify({ ok, at: Date.now(), error }), id);
}

// The mailbox/number to reply from by default: the one the client wrote to, else the first one allowed to send.
export function defaultSender(kind: AccountKind, key?: string | null) {
  const list = accountsWithSecrets(kind).filter((a) => a.canSend);
  return list.find((a) => key && (a.id === key || a.address.toLowerCase() === key.toLowerCase())) ?? list[0] ?? null;
}

// One-time import of the accounts that were configured in .env before this screen existed.
function importFromEnv() {
  if (kvGet("accounts_imported")) return;
  kvSet("accounts_imported", "1");
  for (let i = 1; i <= 20; i++) {
    const e = (k: string) => process.env[`EMAIL${i}_${k}`];
    if (!e("USER") || !e("PASS")) continue;
    const provider = (e("PROVIDER") ?? "custom").toLowerCase();
    const p = EMAIL_PRESETS[provider] ?? EMAIL_PRESETS.custom;
    addAccount({
      kind: "email",
      label: e("LABEL") ?? p.label,
      address: e("USER")!,
      provider,
      config: { imapHost: e("IMAP_HOST") ?? p.imapHost, imapPort: Number(e("IMAP_PORT") ?? p.imapPort), smtpHost: e("SMTP_HOST") ?? p.smtpHost, smtpPort: Number(e("SMTP_PORT") ?? p.smtpPort), username: e("USER")! },
      secret: e("PASS")!,
    });
  }
  const { WA_BASE_URL, WA_SESSION_ID, WA_API_KEY } = process.env;
  if (WA_BASE_URL && WA_SESSION_ID && WA_API_KEY) {
    addAccount({ kind: "whatsapp", label: "WhatsApp", address: WA_SESSION_ID, provider: "chatslash", config: { baseUrl: WA_BASE_URL, sessionId: WA_SESSION_ID }, secret: WA_API_KEY });
  }
}
