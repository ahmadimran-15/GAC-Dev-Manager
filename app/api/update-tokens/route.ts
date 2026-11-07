import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createUpdateToken, revokeUpdateToken, updateTokens } from "@/lib/updatetokens";

export const dynamic = "force-dynamic";

// Tokens another app uses to file team updates. The token itself is only returned when it is made —
// after that the list shows the last few characters, because the only safe place for it is the other
// app's own configuration.
export async function GET() {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const list = await updateTokens();
  return NextResponse.json({
    tokens: list.map((t) => ({ id: t.id, name: t.name, tail: t.token.slice(-6), createdAt: t.createdAt, lastUsed: t.lastUsed })),
  });
}

export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const b = await req.json().catch(() => ({}));
  if (b.action === "revoke") {
    if (!b.id) return NextResponse.json({ error: "Which token?" }, { status: 400 });
    await revokeUpdateToken(String(b.id));
    return NextResponse.json({ ok: true });
  }
  const t = await createUpdateToken(String(b.name ?? ""));
  return NextResponse.json({ ok: true, id: t.id, name: t.name, token: t.token });
}
