import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, cookieOptions, createSession, isHttps, readSession } from "@/lib/session";

// Login required everywhere except the login page and incoming webhooks.
// Team members only reach their portal; everything else is the owner's.
const PUBLIC = [/^\/login/, /^\/api\/auth\//, /^\/api\/webhooks\//];
const TEAM_ALLOWED = [/^\/portal/, /^\/api\/portal/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();

  const s = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (s.role === "team" && !TEAM_ALLOWED.some((r) => r.test(pathname))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/portal";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // Keep active users signed in: renew the cookie once it's past half its life
  if (s.exp - Date.now() < (SESSION_MAX_AGE * 1000) / 2) {
    res.cookies.set(SESSION_COOKIE, await createSession(s), cookieOptions(isHttps(req)));
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
