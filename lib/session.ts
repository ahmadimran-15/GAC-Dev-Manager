// Signed session cookie. Uses Web Crypto so it works in middleware and route handlers.
export const SESSION_COOKIE = "gac_session";
const WEEK = 7 * 24 * 3600 * 1000;
export const SESSION_MAX_AGE = WEEK / 1000;

export interface Session {
  id: string;
  email: string;
  name: string;
  role: "admin" | "team";
  // What this login may open, carried in the cookie so the middleware can decide without a query.
  // Missing (a cookie issued before this existed) counts as both, the behaviour it was issued under.
  portal?: boolean;
  form?: boolean;
  exp: number;
}

export const mayOpen = (s: Session, what: "portal" | "form") => s.role === "admin" || (what === "portal" ? s.portal !== false : s.form !== false);

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

async function key() {
  const secret = process.env.AUTH_SECRET || "dev-only-secret-change-me";
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(data: string) {
  return b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(data)));
}

export async function createSession(u: { id: string; email: string; name: string; role: "admin" | "team"; portal?: boolean; form?: boolean }) {
  const payload = b64url(enc.encode(JSON.stringify({ id: u.id, email: u.email, name: u.name, role: u.role, portal: u.portal !== false, form: u.form !== false, exp: Date.now() + WEEK })));
  return `${payload}.${await sign(payload)}`;
}

export async function readSession(token?: string | null): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || (await sign(payload)) !== sig) return null;
  try {
    const s = JSON.parse(fromB64url(payload)) as Session;
    return s.exp > Date.now() && s.id && s.role ? s : null;
  } catch {
    return null;
  }
}

// Secure cookies only when the page was opened over https (tunnel / domain), so http://localhost still works.
export const isHttps = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

export const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: SESSION_MAX_AGE,
});
