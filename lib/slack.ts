import { kvGet, kvSet } from "@/lib/db";
import { accountsWithSecrets, setAccountStatus, type AccountWithSecret } from "@/lib/accounts";
import { addMessage, findOrCreateConversation, updateConversation } from "@/lib/store";

// Slack direct messages, read with a user token (xoxp-).
//
// A bot token cannot see your own DMs — a bot only sees channels it is invited to — and the people
// you need here (Miriam, Mark) write to you directly. A user token reads what you can read, so the
// conversations arrive the way they do in Slack itself.
//
// It polls, like the mailboxes do, rather than taking events on a public URL. That means no Request
// URL for Slack to verify, no bot to invite anywhere, and nothing lost while the server is asleep:
// the next poll picks up whatever arrived meanwhile.

const API = "https://slack.com/api";

interface SlackError {
  ok: false;
  error: string;
}

async function call<T>(token: string, method: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = `${API}/${method}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  const data = (await res.json().catch(() => null)) as (T & { ok: true }) | SlackError | null;
  if (!data) throw new Error(`Slack ${method}: no answer`);
  if (!("ok" in data) || !data.ok) throw new Error(`Slack ${method}: ${(data as SlackError)?.error ?? "failed"}`);
  return data as T;
}

async function post<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok: true }) | SlackError | null;
  if (!data) throw new Error(`Slack ${method}: no answer`);
  if (!("ok" in data) || !data.ok) throw new Error(`Slack ${method}: ${(data as SlackError)?.error ?? "failed"}`);
  return data as T;
}

// Who the token belongs to, and which workspace. Used when a Slack account is added, so the label
// in Settings is the workspace name rather than something typed by hand.
export async function whoAmI(token: string) {
  const r = await call<{ user_id: string; user: string; team: string; team_id: string; url: string }>(token, "auth.test");
  return { userId: r.user_id, user: r.user, team: r.team, teamId: r.team_id, url: r.url };
}

export const slackAccounts = () => accountsWithSecrets("slack");

interface Im {
  id: string;
  user?: string;
  is_im?: boolean;
  is_mpim?: boolean;
}

// Every DM and group DM this token can see.
async function conversations(a: AccountWithSecret) {
  const r = await call<{ channels: Im[] }>(a.secret, "users.conversations", { types: "im,mpim", limit: 200, exclude_archived: "true" });
  return r.channels ?? [];
}

// Display names, cached for the life of the process: a DM list of 30 people is 30 lookups otherwise.
const names = new Map<string, string>();
async function nameFor(a: AccountWithSecret, userId: string) {
  if (!userId) return "Slack";
  const hit = names.get(userId);
  if (hit) return hit;
  try {
    const r = await call<{ user: { real_name?: string; profile?: { real_name?: string; display_name?: string }; name?: string } }>(a.secret, "users.info", { user: userId });
    const n = r.user?.real_name || r.user?.profile?.real_name || r.user?.profile?.display_name || r.user?.name || userId;
    names.set(userId, n);
    return n;
  } catch {
    return userId;
  }
}

interface Msg {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  subtype?: string;
}

const seenKey = (accountId: string, channel: string) => `slack:${accountId}:${channel}`;

// One pass over the DMs of one account. Returns how many new messages were stored.
export async function pollSlack(a: AccountWithSecret, onNew: (convId: string) => void) {
  let stored = 0;
  const me = await whoAmI(a.secret);
  for (const c of await conversations(a)) {
    const since = (await kvGet(seenKey(a.id, c.id))) ?? "";
    let msgs: Msg[] = [];
    try {
      const r = await call<{ messages: Msg[] }>(a.secret, "conversations.history", { channel: c.id, limit: since ? 50 : 10, ...(since ? { oldest: since } : {}) });
      msgs = (r.messages ?? []).filter((m) => m.ts !== since);
    } catch (e) {
      // A DM we cannot read (a shared channel, a left workspace) must not stop the rest.
      if (!/not_in_channel|channel_not_found|missing_scope/.test(String(e))) throw e;
      continue;
    }
    if (!msgs.length) continue;
    const newest = msgs[0]?.ts ?? since;
    // Oldest first, so the thread reads in order
    for (const m of [...msgs].reverse()) {
      if (m.subtype && m.subtype !== "bot_message") continue; // joins, leaves, topic changes
      const mine = m.user === me.userId;
      const who = c.is_mpim ? "Group DM" : await nameFor(a, c.user ?? m.user ?? "");
      const conv = await findOrCreateConversation({ channel: "slack", externalId: c.id, account: a.id, name: who });
      const id = await addMessage({
        conv_id: conv.id,
        direction: mine ? "out" : "in",
        text: String(m.text ?? ""),
        external_id: `${c.id}-${m.ts}`,
        created_at: Math.round(Number(m.ts) * 1000) || Date.now(),
        sent_by: mine ? "me" : undefined,
        via: a.label,
      });
      if (id) {
        stored++;
        if (!mine) onNew(conv.id);
      }
      if (conv.name !== who && who) await updateConversation(conv.id, { name: who });
    }
    await kvSet(seenKey(a.id, c.id), String(newest));
  }
  await setAccountStatus(a.id, true);
  return stored;
}

// Replying from the dashboard. With a user token the message comes from you, not from a bot.
export async function sendSlack(accountId: string | null | undefined, channel: string, text: string) {
  const list = await slackAccounts();
  const a = list.find((x) => x.id === accountId) ?? list[0];
  if (!a) return { ok: true as const, simulated: true as const };
  const r = await post<{ ts: string }>(a.secret, "chat.postMessage", { channel, text, as_user: true });
  return { ok: true as const, id: r.ts };
}

export const slackConfigured = async () => (await slackAccounts()).length > 0;
