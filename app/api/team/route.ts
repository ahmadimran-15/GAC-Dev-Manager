import { NextResponse } from "next/server";
import { board } from "@/lib/clickup";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.has("refresh");
  return NextResponse.json(await board(force));
}
