import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, cookieOptions, createSession, isHttps, mayOpen, readSession } from "@/lib/session";

// Login required everywhere except the login page and incoming webhooks.
// Team members only reach their portal; everything else is the owner's.
const PUBLIC = [/^\/login/, /^\/api\/auth\//, /^\/api\/webhooks\//];
// /form is the update form: a login the owner created in Settings → Logins, so every update carries
// a real name. It only ever shows project and task names, never a client, a number or a chat.
// Each half is switched on per login in Settings → Logins, so a teammate given only the form
// never reaches the WhatsApp portal, and the other way round.
const PORTAL = [/^\/portal/, /^\/api\/portal/];
const FORM = [/^\/form$/, /^\/api\/form$/];

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

  if (s.role === "team") {
    const wants = PORTAL.some((r) => r.test(pathname)) ? "portal" : FORM.some((r) => r.test(pathname)) ? "form" : null;
    if (!wants || !mayOpen(s, wants)) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
      const home = mayOpen(s, "form") ? "/form" : mayOpen(s, "portal") ? "/portal" : "/login";
      // Nowhere left to send them: the owner has switched both halves off, so end the session.
      if (home === "/login" && pathname === "/login") return NextResponse.next();
      const url = req.nextUrl.clone();
      url.pathname = home;
      url.search = "";
      return NextResponse.redirect(url);
    }
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
