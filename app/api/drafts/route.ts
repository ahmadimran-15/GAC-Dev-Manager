import { NextResponse } from "next/server";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

// Team updates you already approved or discarded, newest first (the pending ones come with /api/state)
export async function GET() {
  const rows = await all<{ id: string; author: string; text: string; project: string | null; status: string; sent_to: string | null; created_at: number; conv_name: string | null }>(
    "select d.id, d.author, d.text, d.project, d.status, d.sent_to, d.created_at, c.name conv_name from drafts d left join conversations c on c.id = d.conv_id where d.status <> 'pending' order by d.created_at desc limit 40",
  );
  return NextResponse.json({ drafts: rows.map((r) => ({ ...r, created_at: Number(r.created_at) })) });
}
