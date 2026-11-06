import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { addAccount, deleteAccount, listAccounts } from "@/lib/accounts";
import { discordReach, startDiscord, stopDiscord, syncDiscord } from "@/lib/discord";

export const dynamic = "force-dynamic";

// The Discord bot: one token, and whichever servers you have invited it to.
export async function GET() {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const accounts = await listAccounts("discord");
  const reach = await Promise.all(accounts.map(async (a) => ({ id: a.id, servers: await discordReach(a.id) })));
  return NextResponse.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      status: a.status,
      servers: reach.find((r) => r.id === a.id)?.servers ?? [],
    })),
  });
}

export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const b = await req.json().catch(() => ({}));

  if (b.action === "remove") {
    if (!b.id) return NextResponse.json({ error: "Which bot?" }, { status: 400 });
    await stopDiscord(String(b.id));
    await deleteAccount(String(b.id));
    return NextResponse.json({ ok: true });
  }

  if (b.action === "reconnect") {
    await syncDiscord();
    return NextResponse.json({ ok: true });
  }

  const token = String(b.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "Paste the bot token" }, { status: 400 });
  if (token.startsWith("xoxb-") || token.startsWith("xoxp-")) return NextResponse.json({ error: "That is a Slack token. Discord's is on the Bot tab of the developer portal." }, { status: 400 });
  try {
    const id = await addAccount({ kind: "discord", label: String(b.label ?? "Discord").trim() || "Discord", address: "bot", provider: "discord", config: {}, secret: token, canSend: true });
    // Connect straight away, so a wrong token is reported here rather than silently never arriving.
    const list = await (await import("@/lib/accounts")).accountsWithSecrets("discord");
    const a = list.find((x) => x.id === id);
    if (a) await startDiscord(a);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Discord rejected that token" }, { status: 400 });
  }
}
