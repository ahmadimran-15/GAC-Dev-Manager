import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSession } from "@/lib/session";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Single owner account, set in .env (ADMIN_EMAIL / ADMIN_PASSWORD).
export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return NextResponse.json({ error: "Set ADMIN_EMAIL and ADMIN_PASSWORD in .env" }, { status: 500 });
  if (!same(String(email ?? "").trim().toLowerCase(), ADMIN_EMAIL.toLowerCase()) || !same(String(password ?? ""), ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(ADMIN_EMAIL), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !!process.env.PUBLIC_URL?.startsWith("https"),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
