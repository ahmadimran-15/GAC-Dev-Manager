import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { all, get, run, uid } from "@/lib/db";

// Logins live in the database. Admin = the owner (everything). Team = can only submit client
// updates for approval; they never see client contact details or channels.

export type Role = "admin" | "team";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  clickupName: string | null; // their ClickUp username, for "My tasks" and timers
  // Which halves of the team side this login may open. The owner always has both.
  canPortal: boolean; // the WhatsApp portal
  canForm: boolean; // the update form
  waAccounts: string[]; // which WhatsApp numbers they see in the portal; empty = the shared setting
  lastLogin: number | null;
  createdAt: number;
}

interface Row {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  active: number;
  clickup_name: string | null;
  can_portal: number | null;
  can_form: number | null;
  wa_accounts: string | null;
  last_login: number | null;
  created_at: number;
}

// An older row has no access columns yet, so a missing value counts as allowed: nobody loses access
// to something they could already open just because the column was added underneath them.
const flag = (v: number | null | undefined) => v === null || v === undefined || !!v;

const parseList = (v: string | null) => {
  try {
    const a = JSON.parse(v ?? "null");
    return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const toUser = (r: Row): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  active: !!r.active,
  clickupName: r.clickup_name ?? null,
  canPortal: r.role === "admin" || flag(r.can_portal),
  canForm: r.role === "admin" || flag(r.can_form),
  waAccounts: parseList(r.wa_accounts),
  lastLogin: r.last_login ? Number(r.last_login) : null,
  createdAt: Number(r.created_at),
});

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 64).toString("hex")}`;
}

function checkPassword(pw: string, stored: string) {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(pw, Buffer.from(saltHex, "hex"), want.length);
  return timingSafeEqual(want, got);
}

// First run: create the owner account from ADMIN_EMAIL / ADMIN_PASSWORD. After that the database is the source of truth.
let ensuring: Promise<void> | null = null;
export function ensureAdmin() {
  ensuring ??= (async () => {
    if (await get("select 1 from users where role = 'admin' limit 1")) return;
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
    await run("insert into users (id, email, name, role, password_hash, created_at) values (?,?,?,?,?,?) on conflict (email) do nothing", uid("u_"), ADMIN_EMAIL.toLowerCase(), "Owner", "admin", hashPassword(ADMIN_PASSWORD), Date.now());
  })();
  ensuring.catch(() => (ensuring = null));
  return ensuring;
}

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  await ensureAdmin();
  const r = await get<Row>("select * from users where lower(email) = lower(?) and active = 1", email.trim());
  if (!r || !checkPassword(password, r.password_hash)) return null;
  await run("update users set last_login = ? where id = ?", Date.now(), r.id);
  return toUser(r);
}

export async function listUsers() {
  return (await all<Row>("select * from users order by role, created_at")).map(toUser);
}

export async function getUser(id: string) {
  const r = await get<Row>("select * from users where id = ?", id);
  return r ? toUser(r) : null;
}

export async function createUser(u: { email: string; name: string; role: Role; password: string; clickupName?: string | null; canPortal?: boolean; canForm?: boolean }) {
  if (u.password.length < 8) throw new Error("Password must be at least 8 characters");
  if (await get("select 1 from users where lower(email) = lower(?)", u.email.trim())) throw new Error("A login with this email already exists");
  const id = uid("u_");
  await run(
    "insert into users (id, email, name, role, password_hash, clickup_name, can_portal, can_form, created_at) values (?,?,?,?,?,?,?,?,?)",
    id,
    u.email.trim().toLowerCase(),
    u.name.trim(),
    u.role,
    hashPassword(u.password),
    u.clickupName || null,
    u.canPortal === false ? 0 : 1,
    u.canForm === false ? 0 : 1,
    Date.now(),
  );
  return id;
}

export async function updateUser(id: string, f: { name?: string; active?: boolean; password?: string; role?: Role; clickupName?: string | null; canPortal?: boolean; canForm?: boolean; waAccounts?: string[] }) {
  if (f.waAccounts !== undefined) await run("update users set wa_accounts = ? where id = ?", JSON.stringify([...new Set((f.waAccounts ?? []).map(String))]), id);
  if (f.canPortal !== undefined) await run("update users set can_portal = ? where id = ?", f.canPortal ? 1 : 0, id);
  if (f.canForm !== undefined) await run("update users set can_form = ? where id = ?", f.canForm ? 1 : 0, id);
  if (f.password !== undefined) {
    if (f.password.length < 8) throw new Error("Password must be at least 8 characters");
    await run("update users set password_hash = ? where id = ?", hashPassword(f.password), id);
  }
  if (f.name !== undefined) await run("update users set name = ? where id = ?", f.name.trim(), id);
  if (f.active !== undefined) await run("update users set active = ? where id = ?", f.active ? 1 : 0, id);
  if (f.role !== undefined) await run("update users set role = ? where id = ?", f.role, id);
  if (f.clickupName !== undefined) await run("update users set clickup_name = ? where id = ?", f.clickupName || null, id);
}

export async function deleteUser(id: string) {
  await run("delete from users where id = ?", id);
}

export async function adminCount() {
  return Number((await get<{ n: number }>("select count(*) n from users where role = 'admin' and active = 1"))?.n ?? 0);
}
