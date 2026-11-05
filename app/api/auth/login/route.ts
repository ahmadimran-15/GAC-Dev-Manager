import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions, createSession, isHttps } from "@/lib/session";
import { verifyLogin } from "@/lib/users";

// Owner and team logins, stored in the database (passwords hashed with scrypt).
export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  try {
    const u = await verifyLogin(String(email), String(password));
    if (!u) {
      await new Promise((r) => setTimeout(r, 600));
      return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
    }
    if (u.role === "team" && !u.canPortal && !u.canForm) return NextResponse.json({ error: "This login has no access yet. Ask the owner to switch something on." }, { status: 403 });
    // Land on whichever side they actually have: the WhatsApp portal, or the update form.
    const home = u.role === "admin" ? "/" : u.canPortal ? "/portal" : "/form";
    const res = NextResponse.json({ ok: true, role: u.role, home });
    res.cookies.set(SESSION_COOKIE, await createSession({ ...u, portal: u.canPortal, form: u.canForm }), cookieOptions(isHttps(req)));
    return res;
  } catch (e) {
    return NextResponse.json({ error: `Can't reach the database: ${e instanceof Error ? e.message : e}` }, { status: 503 });
  }
}
