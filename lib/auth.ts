import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/session";

// The signed-in user for a route handler (middleware already blocked anonymous requests).
export async function currentUser() {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireAdmin() {
  const u = await currentUser();
  return u?.role === "admin" ? { user: u, deny: null } : { user: u, deny: NextResponse.json({ error: "Only the owner can do this" }, { status: 403 }) };
}

// The signed cookie carries what a login could open when it was issued, which is enough for the
// middleware to turn away the obvious cases quickly. It is NOT the authority: a cookie lasts a week,
// so a teammate whose access was withdrawn would keep the old answer in their pocket until it
// expired. Every route that actually serves team data asks the database instead, which is why
// unticking WhatsApp takes effect on their very next request rather than next Monday.
export async function requireTeam(what: "portal" | "form") {
  const u = await currentUser();
  if (!u) return { user: null, deny: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (u.role === "admin") return { user: u, deny: null };
  const { getUser } = await import("@/lib/users");
  const live = await getUser(u.id).catch(() => null);
  if (!live || !live.active) return { user: null, deny: NextResponse.json({ error: "This login is no longer active", signedOut: true }, { status: 403 }) };
  const allowed = what === "portal" ? live.canPortal : live.canForm;
  if (!allowed) return { user: null, deny: NextResponse.json({ error: `You no longer have access to ${what === "portal" ? "WhatsApp" : "the update form"}.`, signedOut: true }, { status: 403 }) };
  return { user: u, deny: null };
}
