import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { mailLists, robotSender, setMailLists } from "@/lib/mailfilter";

export const dynamic = "force-dynamic";

// A mailbox name that belongs to a company rather than a person. Used only when tidying up threads
// that are already in the inbox, where the original headers are long gone — never on live mail, where
// info@ or hello@ really can be the person you are working with.
const GENERIC = /^(info|hello|hi|team|news|contact|discover|training|welcome|verify|alert|alerts|docs|email|mail|sales|care|hey|community|product|updates?|notify|service|do-?not-?reply)$/i;

export async function GET() {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const lists = await mailLists();
  const rows = await all<{ id: string; name: string; external_id: string; bulk: number; replies: number; msgs: number; last_at: number | null }>(
    `select c.id, c.name, c.external_id, c.bulk,
       (select count(*) from messages m where m.conv_id = c.id and m.direction = 'out') replies,
       (select count(*) from messages m where m.conv_id = c.id) msgs,
       (select max(created_at) from messages m where m.conv_id = c.id) last_at
     from conversations c where c.channel = 'email' and c.demo = 0 order by last_at desc`,
  );
  const threads = rows.map((r) => {
    const local = String(r.external_id).split("@")[0] ?? "";
    return {
      ...r,
      bulk: !!r.bulk,
      replies: Number(r.replies),
      msgs: Number(r.msgs),
      last_at: r.last_at ? Number(r.last_at) : null,
      suggest: !r.bulk && Number(r.replies) === 0 && (robotSender(r.external_id) || GENERIC.test(local)),
    };
  });
  return NextResponse.json({ lists, threads });
}

export async function POST(req: Request) {
  const { deny } = await requireAdmin();
  if (deny) return deny;
  const b = await req.json().catch(() => ({}));

  if (b.action === "lists") return NextResponse.json({ ok: true, lists: await setMailLists({ always: b.always, never: b.never }) });

  // "Tidy up": files every suggested thread under Updates in one go. Only threads you have never
  // replied to are touched, and each one can be moved back from the Updates folder afterwards.
  if (b.action === "tidy") {
    const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String) : [];
    if (!ids.length) return NextResponse.json({ ok: true, moved: 0 });
    const rows = await all<{ id: string; external_id: string; replies: number }>(
      `select c.id, c.external_id, (select count(*) from messages m where m.conv_id = c.id and m.direction = 'out') replies
         from conversations c where c.channel = 'email' and c.id in (${ids.map(() => "?").join(",")})`,
      ...ids,
    );
    const safe = rows.filter((r) => Number(r.replies) === 0);
    for (const r of safe) await run("update conversations set bulk = 1 where id = ?", r.id);
    const lists = await mailLists();
    await setMailLists({ always: lists.always, never: [...lists.never, ...safe.map((r) => String(r.external_id).toLowerCase())] });
    return NextResponse.json({ ok: true, moved: safe.length, skipped: rows.length - safe.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
