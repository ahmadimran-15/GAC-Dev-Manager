import { NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { listTargets } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Search your WhatsApp groups or contacts (from the gateway, cached for 10 minutes).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const type = u.searchParams.get("type") === "contacts" ? "contacts" : "groups";
  const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
  const a = await getAccount(u.searchParams.get("account") ?? "");
  if (!a || a.kind !== "whatsapp") return NextResponse.json({ error: "Pick a WhatsApp number first" }, { status: 400 });
  try {
    const list = await listTargets(a, type, u.searchParams.has("refresh"));
    const digits = q.replace(/[^\d]/g, "");
    const hits = q ? list.filter((t) => t.name.toLowerCase().includes(q) || (digits.length >= 3 && (t.number ?? t.id).includes(digits))) : list;
    return NextResponse.json({ total: list.length, results: hits.slice(0, 60) });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't load from WhatsApp: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
