import { NextResponse } from "next/server";
import { clearDemo } from "@/lib/demo";

export async function POST() {
  clearDemo();
  return NextResponse.json({ ok: true });
}
