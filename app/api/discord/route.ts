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
      webhook: a.provider === "discord-webhook",
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

  // A webhook URL instead of a bot: send-only, into a channel somebody else administers.
  if (b.webhook !== undefined) {
    const url = String(b.webhook ?? "").trim();
    const { looksLikeWebhook, sendDiscordWebhook, WEBHOOK_PREFIX } = await import("@/lib/discord");
    if (!looksLikeWebhook(url)) return NextResponse.json({ error: "That is not a Discord webhook URL — it should start https://discord.com/api/webhooks/" }, { status: 400 });
    const label = String(b.label ?? "").trim() || "Discord channel";
    // Prove it works before saving it, so a mistyped URL is caught here and not at 9 pm on a Sunday.
    const test = await sendDiscordWebhook(url, `✅ ${label} is connected to GAC Desk.`, label);
    if (!test.ok) return NextResponse.json({ error: test.error }, { status: 400 });
    const id = await addAccount({ kind: "discord", label, address: "webhook", provider: "discord-webhook", config: {}, secret: url, canSend: true });
    const { findOrCreateConversation } = await import("@/lib/store");
    const conv = await findOrCreateConversation({ channel: "discord", externalId: `${WEBHOOK_PREFIX}${id}`, account: id, name: label });
    return NextResponse.json({ ok: true, id, conversation: conv.id });
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
