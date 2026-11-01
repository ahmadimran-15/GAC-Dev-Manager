import { NextResponse } from "next/server";
import { estimateMissing } from "@/lib/estimates";

export const dynamic = "force-dynamic";

// Team page → "Estimate open tasks": Gemini's strict projection for every open task that has none yet
export async function POST() {
  try {
    return NextResponse.json(await estimateMissing(150));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini failed" }, { status: 500 });
  }
}
