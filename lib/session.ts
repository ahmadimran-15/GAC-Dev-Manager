// Signed session cookie. Uses Web Crypto so it works in middleware and route handlers.
export const SESSION_COOKIE = "gac_session";
const WEEK = 7 * 24 * 3600 * 1000;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function key() {
  const secret = process.env.AUTH_SECRET || "dev-only-secret-change-me";
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(data: string) {
  return b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(data)));
}

export async function createSession(user: string) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: Date.now() + WEEK })));
  return `${payload}.${await sign(payload)}`;
}

export async function readSession(token?: string | null): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || (await sign(payload)) !== sig) return null;
  try {
    const { u, exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return exp > Date.now() ? u : null;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = WEEK / 1000;
