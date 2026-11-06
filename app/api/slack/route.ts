import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { addAccount, deleteAccount, listAccounts } from "@/lib/accounts";
import { whoAmI } from "@/lib/slack";

export const dynamic = "force-dynamic";

// Slack workspaces connected with a user token (xoxp-). One per workspace; the token is stored
// encrypted with the mailbox and WhatsApp secrets and never leaves the server.
export async function GET() {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const accounts = (await listAccounts("slack")).map((a) => ({ id: a.id, label: a.label, address: a.address, enabled: a.enabled, status: a.status }));
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const b = await req.json().catch(() => ({}));

  if (b.action === "remove") {
    if (!b.id) return NextResponse.json({ error: "Which workspace?" }, { status: 400 });
    await deleteAccount(String(b.id));
    return NextResponse.json({ ok: true });
  }

  const token = String(b.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "Paste the User OAuth Token" }, { status: 400 });
  if (!token.startsWith("xoxp-"))
    return NextResponse.json(
      { error: "That looks like a bot token. A bot cannot read your own DMs — use the User OAuth Token, which starts with xoxp-." },
      { status: 400 },
    );
  try {
    // The token says which workspace and which person it belongs to, so nothing has to be typed.
    const me = await whoAmI(token);
    const id = await addAccount({ kind: "slack", label: me.team, address: me.user, provider: "slack", config: { username: me.userId }, secret: token, canSend: true });
    return NextResponse.json({ ok: true, id, team: me.team, user: me.user });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Slack rejected that token" }, { status: 400 });
  }
}
