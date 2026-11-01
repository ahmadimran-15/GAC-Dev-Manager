import { kvGet, kvSet } from "@/lib/db";

// WhatsApp groups whose messages come into the inbox. A group is added automatically the first
// time you send to it, so random community groups never clutter the inbox.

export async function trackedGroups(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await kvGet("wa_groups")) ?? "{}");
  } catch {
    return {};
  }
}

export async function trackGroup(id: string, name: string) {
  const g = await trackedGroups();
  if (g[id] === name) return;
  g[id] = name;
  await kvSet("wa_groups", JSON.stringify(g));
}

export async function untrackGroup(id: string) {
  const g = await trackedGroups();
  delete g[id];
  await kvSet("wa_groups", JSON.stringify(g));
}
