import { kvGet, kvSet } from "@/lib/db";

// Which WhatsApp numbers the team portal is allowed to show. With two sessions connected, one may be
// the company number the team works on and the other private; only the ones listed here reach them.
// Empty list (the default) means every connected number, which is how it behaved before this existed.

const KEY = "team_wa_accounts";

export async function teamWaAccounts(): Promise<string[]> {
  try {
    const saved = JSON.parse((await kvGet(KEY)) ?? "null");
    return Array.isArray(saved) ? saved.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function setTeamWaAccounts(ids: string[]) {
  const clean = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))];
  await kvSet(KEY, JSON.stringify(clean));
  return clean;
}

// A conversation the team may see: on one of the chosen numbers, or any number when none is chosen.
export const onTeamAccount = (allowed: string[], account: string | null | undefined) => !allowed.length || (!!account && allowed.includes(account));
