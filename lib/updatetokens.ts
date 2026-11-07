import { randomBytes, timingSafeEqual } from "crypto";
import { kvGet, kvSet } from "@/lib/db";

// Tokens for another app to post a team update into the approval queue.
//
// The update form inside GAC Desk signs people in; another codebase cannot. It carries a token
// instead — one per app, not one per person, because the app says who wrote each update. A token is
// a bearer credential: whoever holds it can file updates as anyone, so it is worth rotating if it
// ever goes somewhere it should not.

const KEY = "update_tokens";

export interface UpdateToken {
  id: string;
  name: string; // "Tracking app", so a token can be recognised later
  token: string;
  createdAt: number;
  lastUsed: number | null;
}

export async function updateTokens(): Promise<UpdateToken[]> {
  try {
    const saved = JSON.parse((await kvGet(KEY)) ?? "[]");
    return Array.isArray(saved) ? (saved as UpdateToken[]) : [];
  } catch {
    return [];
  }
}

export async function createUpdateToken(name: string) {
  const list = await updateTokens();
  const t: UpdateToken = {
    id: `t_${randomBytes(6).toString("hex")}`,
    name: String(name ?? "").trim().slice(0, 40) || "App",
    token: `gacu_${randomBytes(24).toString("hex")}`,
    createdAt: Date.now(),
    lastUsed: null,
  };
  await kvSet(KEY, JSON.stringify([...list, t]));
  return t;
}

export async function revokeUpdateToken(id: string) {
  await kvSet(KEY, JSON.stringify((await updateTokens()).filter((t) => t.id !== id)));
}

// Compared in constant time, so the answer cannot be guessed a character at a time.
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function checkUpdateToken(presented: string | null) {
  const given = String(presented ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) return null;
  const list = await updateTokens();
  const hit = list.find((t) => same(t.token, given));
  if (!hit) return null;
  // Last used is handy when deciding whether a token is still in service before revoking it.
  await kvSet(KEY, JSON.stringify(list.map((t) => (t.id === hit.id ? { ...t, lastUsed: Date.now() } : t)))).catch(() => {});
  return hit;
}
