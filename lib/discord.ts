import { accountsWithSecrets, setAccountStatus, type AccountWithSecret } from "@/lib/accounts";
import { addMessage, findOrCreateConversation } from "@/lib/store";
import { logEvent } from "@/lib/db";

// Discord, over the gateway — a connection that stays open rather than a webhook, because Discord
// has no way to push messages to a URL. The connection is held by the worker, so it lives as long as
// the server does; if the host puts the server to sleep the connection drops and is re-made on wake.
//
// Only server channels. A bot cannot read anyone's private DMs, and using a personal account as a
// bot to get around that is against Discord's terms, so this does not try.

export const discordAccounts = () => accountsWithSecrets("discord");

// One live client per account, kept on globalThis so a hot reload in development does not leave a
// second connection behind answering the same messages twice.
const g = globalThis as unknown as { __gacDiscord?: Map<string, { destroy: () => void }> };
const clients = (g.__gacDiscord ??= new Map());

export async function startDiscord(a: AccountWithSecret) {
  if (clients.has(a.id)) return;
  const { Client, GatewayIntentBits, Partials, Events } = await import("discord.js");
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
  });
  clients.set(a.id, client);

  client.once(Events.ClientReady, async (c) => {
    await setAccountStatus(a.id, true);
    await logEvent("discord", { account: a.label, as: c.user.tag, servers: c.guilds.cache.size });
  });

  client.on(Events.MessageCreate, async (m) => {
    try {
      if (m.author?.bot && m.author.id === client.user?.id) return; // our own posts come back on the wire
      const guild = m.guild?.name ?? "Discord";
      const channel = "name" in m.channel && m.channel.name ? `#${m.channel.name}` : "channel";
      const conv = await findOrCreateConversation({ channel: "discord", externalId: m.channelId, account: a.id, name: `${channel} · ${guild}`, company: guild });
      const mine = m.author?.id === client.user?.id;
      // Attachments arrive as URLs; the text alone would read as an empty message.
      const extra = m.attachments.size ? `\n${[...m.attachments.values()].map((f) => f.url).join("\n")}` : "";
      const id = await addMessage({
        conv_id: conv.id,
        direction: mine ? "out" : "in",
        text: `${m.author?.bot && !mine ? "" : `${m.author?.displayName ?? m.author?.username ?? "someone"}: `}${m.content}${extra}`.trim(),
        external_id: m.id,
        created_at: m.createdTimestamp,
        sent_by: mine ? "me" : undefined,
        via: a.label,
      });
      if (id && !mine) {
        const { afterIncoming } = await import("@/lib/inbound");
        afterIncoming(conv.id);
      }
    } catch (e) {
      await logEvent("discord-error", { account: a.label, error: String(e) }).catch(() => {});
    }
  });

  client.on(Events.Error, async (e) => {
    await setAccountStatus(a.id, false, String(e)).catch(() => {});
  });

  try {
    await client.login(a.secret);
  } catch (e) {
    clients.delete(a.id);
    await setAccountStatus(a.id, false, String(e));
    throw e;
  }
}

export async function stopDiscord(accountId: string) {
  const c = clients.get(accountId);
  if (!c) return;
  clients.delete(accountId);
  try {
    c.destroy();
  } catch {
    /* already gone */
  }
}

// Called by the worker on start and then every few minutes, so an account added in Settings connects
// without a restart and a dropped connection is re-made.
export async function syncDiscord() {
  const accounts = await discordAccounts();
  for (const id of clients.keys()) if (!accounts.some((a) => a.id === id)) await stopDiscord(id);
  for (const a of accounts) await startDiscord(a).catch(() => {});
  return accounts.length;
}

// Replying from the inbox. It goes out as the bot — Discord has no way for an app to post as you.
export async function sendDiscord(accountId: string | null | undefined, channelId: string, text: string) {
  const list = await discordAccounts();
  const a = list.find((x) => x.id === accountId) ?? list[0];
  if (!a) return { ok: true as const, simulated: true as const };
  await startDiscord(a);
  const client = clients.get(a.id) as unknown as { channels: { fetch: (id: string) => Promise<unknown> } } | undefined;
  const channel = (await client?.channels.fetch(channelId)) as { isTextBased?: () => boolean; send?: (t: string) => Promise<{ id: string }> } | undefined;
  if (!channel?.send) return { ok: false as const, error: "That Discord channel can't be posted to" };
  const sent = await channel.send(text);
  return { ok: true as const, id: sent.id };
}

// What the bot can actually see, for Settings: which servers and channels it has been invited to.
export async function discordReach(accountId: string) {
  const client = clients.get(accountId) as unknown as
    | { guilds: { cache: Map<string, { name: string; channels: { cache: Map<string, { name: string; isTextBased?: () => boolean }> } }> } }
    | undefined;
  if (!client) return [];
  return [...client.guilds.cache.values()].map((gld) => ({
    server: gld.name,
    channels: [...gld.channels.cache.values()].filter((c) => c.isTextBased?.()).map((c) => `#${c.name}`),
  }));
}
