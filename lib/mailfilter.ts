import { get, kvGet, kvSet } from "@/lib/db";

// Which incoming mail is a newsletter, a receipt or a service notice rather than a person writing to
// you. Nothing is ever thrown away on the strength of this: the mail is stored either way, and a
// "bulk" conversation simply lives under Updates instead of the client inbox, never counts as waiting
// and never reaches the reminders. Getting it wrong costs one click, not a lost client.

export interface MailLists {
  always: string[]; // never bulk, whatever the headers say (a domain or a full address)
  never: string[]; // always bulk (a domain or a full address)
}

const KEY = "mail_lists";

export async function mailLists(): Promise<MailLists> {
  try {
    const saved = JSON.parse((await kvGet(KEY)) ?? "null");
    return { always: clean(saved?.always), never: clean(saved?.never) };
  } catch {
    return { always: [], never: [] };
  }
}

const clean = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((s) => String(s).trim().toLowerCase()).filter(Boolean))] : []);

export async function setMailLists(l: Partial<MailLists>) {
  const out: MailLists = { always: clean(l.always), never: clean(l.never) };
  await kvSet(KEY, JSON.stringify(out));
  return out;
}

const domainOf = (address: string) => address.split("@")[1] ?? "";
const listed = (list: string[], address: string) => list.some((e) => e === address || e === domainOf(address) || domainOf(address).endsWith(`.${e}`));

// The sender looks like a machine: no-reply, notifications, billing, alerts… Checked on the part
// before the @ as a whole word, so "noreply-accounts@google.com" counts and "mark@…" does not.
const ROBOT = /(^|[.\-_+])(no-?reply|donotreply|notifications?|alerts?|mailer-daemon|newsletter|news|marketing|billing|invoices?|receipts?|support-?noreply|bounce|postmaster|verify|welcome|updates?)([.\-_+]|$)/i;

export const robotSender = (address: string) => ROBOT.test(address.split("@")[0] ?? "");

export interface MailSignals {
  listUnsubscribe: boolean;
  precedenceBulk: boolean;
  autoSubmitted: boolean;
}

// Headers that say "this was sent to a list", read straight off the message.
export function signalsFrom(headers: Map<string, unknown> | undefined): MailSignals {
  const h = (k: string) => {
    const v = headers?.get(k);
    return v === undefined || v === null ? "" : String(typeof v === "object" ? JSON.stringify(v) : v).toLowerCase();
  };
  return {
    listUnsubscribe: !!headers?.has("list-unsubscribe") || !!headers?.has("list-id"),
    precedenceBulk: /bulk|list|junk/.test(h("precedence")),
    autoSubmitted: !!h("auto-submitted") && h("auto-submitted") !== "no",
  };
}

// Have we ever written to this address? Then it is a correspondent, not a mailing list, and it is
// never filed under Updates however it looks — the one guard that matters most.
async function haveReplied(address: string) {
  const r = await get<{ n: number }>(
    `select count(*) n from messages m join conversations c on c.id = m.conv_id
      where c.channel = 'email' and lower(c.external_id) = ? and m.direction = 'out'`,
    address,
  ).catch(() => null);
  return Number(r?.n ?? 0) > 0;
}

export interface Verdict {
  bulk: boolean;
  why: string;
}

export async function classifyMail(address: string, headers?: Map<string, unknown>): Promise<Verdict> {
  const from = address.toLowerCase();
  const lists = await mailLists();
  if (listed(lists.always, from)) return { bulk: false, why: "on your allow list" };
  if (await haveReplied(from)) return { bulk: false, why: "you have replied to this address before" };
  if (listed(lists.never, from)) return { bulk: true, why: "on your block list" };

  const s = signalsFrom(headers);
  if (s.listUnsubscribe) return { bulk: true, why: "sent to a mailing list (List-Unsubscribe)" };
  if (s.precedenceBulk) return { bulk: true, why: "Precedence: bulk" };
  if (s.autoSubmitted) return { bulk: true, why: "automatically generated" };
  if (robotSender(from)) return { bulk: true, why: "sent from a no-reply style address" };
  return { bulk: false, why: "looks like a person" };
}
