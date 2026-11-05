import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { setTeamWaAccounts, teamWaAccounts } from "@/lib/team-access";

export const dynamic = "force-dynamic";

// Which connected WhatsApp numbers the team portal may show. Owner only.
export async function GET() {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const accounts = (await listAccounts("whatsapp")).map((a) => ({ id: a.id, label: a.label ?? a.id, address: a.address ?? null, enabled: a.enabled }));
  return NextResponse.json({ accounts, allowed: await teamWaAccounts() });
}

export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const b = await req.json().catch(() => ({}));
  if (!Array.isArray(b.allowed)) return NextResponse.json({ error: "Send the list of numbers the team may see" }, { status: 400 });
  return NextResponse.json({ ok: true, allowed: await setTeamWaAccounts(b.allowed) });
}
