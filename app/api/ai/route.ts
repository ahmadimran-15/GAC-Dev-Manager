import { NextResponse } from "next/server";
import { draftTicket, polish, rewrite } from "@/lib/ai";
import { allMembers, board } from "@/lib/clickup";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  try {
    if (b.mode === "polish") return NextResponse.json({ text: await polish(String(b.text ?? "")) });
    if (b.mode === "rewrite") return NextResponse.json({ text: await rewrite(String(b.text ?? ""), String(b.instructions ?? "")) });
    if (b.mode === "ticket") {
      // Current projects and people, so "put it in internal tasks, give it to me" picks real names
      const bd = await board().catch(() => null);
      const team = [...new Set([...(bd?.team ?? []), ...(await allMembers().catch(() => [] as string[]))])];
      return NextResponse.json({ ticket: await draftTicket(b.messages ?? [], String(b.instructions ?? ""), b.project, { projects: bd?.projects ?? [], team }) });
    }
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI failed" }, { status: 500 });
  }
}
