import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { allMembers } from "@/lib/clickup";
import { adminCount, createUser, deleteUser, getUser, listUsers, updateUser, type Role } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const members = await allMembers().catch(() => [] as string[]);
  return NextResponse.json({ users: await listUsers(), me: await currentUser(), members });
}

// Owner manages logins: add teammates, reset passwords, pause or remove access, change own password.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const me = await currentUser();
  try {
    switch (b.action) {
      case "create":
        if (!b.email || !b.name || !b.password) return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
        return NextResponse.json({
          id: await createUser({
            email: b.email,
            name: b.name,
            password: b.password,
            role: (b.role === "admin" ? "admin" : "team") as Role,
            clickupName: b.clickupName || null,
            canPortal: b.canPortal !== false,
            canForm: b.canForm !== false,
          }),
        });
      case "update": {
        const target = await getUser(b.id);
        if (!target) return NextResponse.json({ error: "Login not found" }, { status: 404 });
        if (target.role === "admin" && (b.active === false || b.role === "team") && (await adminCount()) <= 1) return NextResponse.json({ error: "You can't remove the last owner login" }, { status: 400 });
        await updateUser(b.id, { name: b.name, active: b.active, password: b.password || undefined, role: b.role, clickupName: b.clickupName, canPortal: b.canPortal, canForm: b.canForm });
        return NextResponse.json({ ok: true });
      }
      case "delete": {
        const target = await getUser(b.id);
        if (!target) return NextResponse.json({ ok: true });
        if (target.id === me?.id) return NextResponse.json({ error: "You can't delete your own login" }, { status: 400 });
        if (target.role === "admin" && (await adminCount()) <= 1) return NextResponse.json({ error: "You can't remove the last owner login" }, { status: 400 });
        await deleteUser(b.id);
        return NextResponse.json({ ok: true });
      }
      case "my-password":
        if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
        await updateUser(me.id, { password: String(b.password ?? "") });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
