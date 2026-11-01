import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { addDraft } from "@/lib/store";
import { board } from "@/lib/clickup";
import { updateUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// Team portal: current projects, client first names (never numbers or emails) and your own submissions.
export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [b, clients, mine] = await Promise.all([
    board(),
    all<{ id: string; name: string; project: string | null; channel: string }>("select id, name, project, channel from conversations where demo = 0 order by name"),
    all<{ id: string; text: string; project: string | null; status: string; created_at: number; conv_name: string | null }>(
      "select d.id, d.text, d.project, d.status, d.created_at, c.name conv_name from drafts d left join conversations c on c.id = d.conv_id where d.author_id = ? order by d.created_at desc limit 30",
      me.id,
    ),
  ]);
  return NextResponse.json({
    me: { name: me.name, email: me.email },
    projects: b.projects,
    clients: clients.map((c) => ({ id: c.id, label: c.channel === "whatsapp" && /@g\.us$/.test(c.name) ? c.name : c.name.split(" ")[0], project: c.project })),
    mine: mine.map((d) => ({ ...d, created_at: Number(d.created_at), conv_name: d.conv_name ? d.conv_name.split(" ")[0] : null })),
  });
}

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.action === "password") {
    try {
      await updateUser(me.id, { password: String(b.password ?? "") });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
    }
  }
  const text = String(b.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Write the update first" }, { status: 400 });
  if (!b.project && !b.conv_id) return NextResponse.json({ error: "Pick the project" }, { status: 400 });
  await addDraft({ conv_id: b.conv_id || null, project: b.project || null, author: me.name, author_id: me.id, text: text.slice(0, 4000) });
  return NextResponse.json({ ok: true });
}
