import { NextResponse } from "next/server";
import { clearDemo } from "@/lib/demo";

export async function POST() {
  await clearDemo();
  return NextResponse.json({ ok: true });
}
