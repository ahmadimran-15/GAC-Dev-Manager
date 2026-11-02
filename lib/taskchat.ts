import { all, kvGet, kvSet, run } from "@/lib/db";
import { addMessage, findOrCreateConversation, updateConversation } from "@/lib/store";

import { clickupMe, taskBrief, taskComments } from "@/lib/clickup";

// ClickUp task comments as inbox conversations: one conversation per task, each comment a message.
// Your own comments (the API token's owner) are "out", everyone else's are "in", so a new comment
// from the team shows as waiting for a reply. Replying from the inbox posts the comment to ClickUp.

export const TASK_CHANNEL = "clickup";
// The time notes GAC Desk used to post on tasks are not messages
const SKIP = (text: string) => text.startsWith("⏱ GAC Desk");

export async function taskConversation(taskId: string, brief?: { title: string; project: string; url: string }) {
  const b = brief ?? (await taskBrief(taskId));
  const conv = await findOrCreateConversation({ channel: TASK_CHANNEL, externalId: taskId, account: "clickup", name: b.title, company: b.project });
  if (conv.name !== b.title || conv.project !== b.project) await updateConversation(conv.id, { name: b.title, project: b.project });
  return conv;
}

// Pulls a task's comments in and stores the new ones. Returns how many arrived from other people.
// Pass `known` (from the board we already have) to save a ClickUp call per task.
export async function syncTaskComments(taskId: string, known?: { title: string; project: string; url: string }) {
  const [brief, comments, me] = await Promise.all([known ?? taskBrief(taskId), taskComments(taskId), clickupMe().catch(() => null)]);
  const live = comments.filter((c) => !SKIP(c.text));
  if (!live.length) return { conv: null, incoming: 0 };
  const conv = await taskConversation(taskId, brief);
  let incoming = 0;
  for (const c of live) {
    const mine = me ? c.userId === me.id : false;
    const added = await addMessage({
      conv_id: conv.id,
      direction: mine ? "out" : "in",
      text: c.text,
      external_id: `cu_${c.id}`,
      sent_by: mine ? "me" : c.user,
      status: mine ? "sent" : null,
      via: "ClickUp",
      created_at: c.at,
    });
    if (added && !mine) incoming++;
  }
  await kvSet(`task_chat_seen:${taskId}`, String(Date.now()));
  return { conv, incoming };
}

// Catches comments the webhook missed: re-reads the tasks we already have a conversation for.
export async function syncRecentTaskChats(limit = 12) {
  const convs = await all<{ external_id: string }>(
    `select c.external_id from conversations c where c.channel = ? and c.demo = 0
     order by coalesce((select max(m.created_at) from messages m where m.conv_id = c.id), c.created_at) desc limit ?`,
    TASK_CHANNEL,
    limit,
  );
  let incoming = 0;
  for (const c of convs) incoming += (await syncTaskComments(c.external_id).catch(() => ({ incoming: 0 }))).incoming;
  return incoming;
}

// A task's conversation id, if the inbox already has one (for the "Comments" link on the Team page)
export async function taskConvIds(taskIds: string[]) {
  if (!taskIds.length) return {};
  const rows = await all<{ id: string; external_id: string }>(`select id, external_id from conversations where channel = ?`, TASK_CHANNEL);
  const want = new Set(taskIds);
  return Object.fromEntries(rows.filter((r) => want.has(r.external_id)).map((r) => [r.external_id, r.id]));
}

// Housekeeping: a task conversation whose task is gone from ClickUp keeps its history, nothing to do.
export const lastTaskSync = async () => Number((await kvGet("task_chat_sync")) ?? 0);
export const noteTaskSync = () => kvSet("task_chat_sync", String(Date.now()));

export async function renameTaskConv(taskId: string, title: string) {
  await run("update conversations set name = ? where channel = ? and external_id = ?", title, TASK_CHANNEL, taskId);
}
