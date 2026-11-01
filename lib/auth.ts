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
