import { kvGet, kvSet } from "@/lib/db";

// WhatsApp numbers on "our side" (boss, partner, the company number). Their messages in a client
// group count as our reply; a direct chat with one of them is internal, never "waiting".
// Your own number is already known (messages from it arrive as fromMe).

export interface TeamNumber {
  name: string;
  number: string; // digits only, with country code
}

const DEFAULTS: TeamNumber[] = [{ name: "Abdullah", number: "13055083815" }];
const digits = (s: string) => s.replace(/[^\d]/g, "");

export async function teamNumbers(): Promise<TeamNumber[]> {
  const raw = await kvGet("team_numbers");
  if (!raw) return DEFAULTS;
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULTS;
  }
}

export async function setTeamNumbers(list: TeamNumber[]) {
  const clean = list
    .map((t) => ({ name: String(t.name ?? "").trim(), number: digits(String(t.number ?? "")) }))
    .filter((t) => t.name && t.number.length >= 8);
  await kvSet("team_numbers", JSON.stringify(clean));
  return clean;
}

// Name of the teammate who owns this number (any format: +1 305…, 1305…@c.us), or null
export async function teamMember(numberOrId: string | null | undefined) {
  const d = digits(String(numberOrId ?? "").split("@")[0]);
  if (!d) return null;
  return (await teamNumbers()).find((t) => t.number === d)?.name ?? null;
}
