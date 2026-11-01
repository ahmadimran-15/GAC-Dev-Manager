import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { addDraft } from "@/lib/store";
import { memberForToken } from "@/lib/team";

// Public endpoint behind a teammate's private token. Never returns phone numbers or emails.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const member = memberForToken(token);
  if (!member) return NextResponse.json({ error: "Invalid link" }, { status: 403 });
  const clients = all<{ id: string; name: string; project: string | null }>("select id, name, project from conversations order by project, name");
  return NextResponse.json({ member, clients: clients.map((c) => ({ id: c.id, label: `${c.name.split(" ")[0]}${c.project ? ` · ${c.project}` : ""}` })) });
}

export async function POST(req: Request) {
  const { token, conv_id, text } = await req.json().catch(() => ({}));
  const member = memberForToken(String(token ?? ""));
  if (!member) return NextResponse.json({ error: "Invalid link" }, { status: 403 });
  if (!String(text ?? "").trim()) return NextResponse.json({ error: "Write a message first" }, { status: 400 });
  addDraft({ conv_id: conv_id || null, project: null, author: member, text: String(text).trim().slice(0, 4000) });
  return NextResponse.json({ ok: true });
}
