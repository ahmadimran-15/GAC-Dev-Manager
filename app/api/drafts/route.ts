import { NextResponse } from "next/server";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

// Team updates you already approved or discarded, newest first (the pending ones come with /api/state)
export async function GET(req: Request) {
  // ?since=<ms> for the day's digest: everything handled since midnight, not just the last 40.
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  const rows = await all<{ id: string; author: string; text: string; project: string | null; status: string; sent_to: string | null; created_at: number; conv_name: string | null }>(
    since
      ? "select d.id, d.author, d.text, d.project, d.status, d.sent_to, d.created_at, c.name conv_name from drafts d left join conversations c on c.id = d.conv_id where d.status <> 'pending' and d.created_at >= ? order by d.created_at desc limit 300"
      : "select d.id, d.author, d.text, d.project, d.status, d.sent_to, d.created_at, c.name conv_name from drafts d left join conversations c on c.id = d.conv_id where d.status <> 'pending' order by d.created_at desc limit 40",
    ...(since ? [since] : []),
  );
  return NextResponse.json({ drafts: rows.map((r) => ({ ...r, created_at: Number(r.created_at) })) });
}
