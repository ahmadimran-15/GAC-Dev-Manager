import { NextResponse } from "next/server";
import { setTeamNumbers, teamNumbers } from "@/lib/team-numbers";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ numbers: await teamNumbers() });
}

// Replaces the list: [{name, number}]
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!Array.isArray(b.numbers)) return NextResponse.json({ error: "Send the full list" }, { status: 400 });
  return NextResponse.json({ numbers: await setTeamNumbers(b.numbers) });
}
