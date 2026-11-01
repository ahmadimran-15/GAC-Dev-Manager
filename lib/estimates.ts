import { all, get, run } from "@/lib/db";
import { chat, parseJson } from "@/lib/ai";
import { board, taskDetail } from "@/lib/clickup";
import { minutesByTask } from "@/lib/timers";

// Two projections per task, visible only to the owner: your own estimate and Gemini's, based on the
// person's past tasks and how long they actually took. Stored here, never in ClickUp.

export interface Estimate {
  task_id: string;
  my_min: number | null;
  ai_min: number | null;
  ai_note: string | null;
}

export async function estimatesMap(): Promise<Record<string, Estimate>> {
  const rows = await all<Estimate>("select task_id, my_min, ai_min, ai_note from estimates");
  return Object.fromEntries(rows.map((r) => [r.task_id, r]));
}

export async function setMyEstimate(taskId: string, minutes: number | null) {
  await run(
    "insert into estimates (task_id, my_min, updated_at) values (?,?,?) on conflict (task_id) do update set my_min = excluded.my_min, updated_at = excluded.updated_at",
    taskId, minutes, Date.now(),
  );
}

export async function aiEstimate(taskId: string) {
  const t = await taskDetail(taskId);
  const b = await board();
  const tracked = await minutesByTask();
  // The person's finished tasks with real time (our timer first, ClickUp's total otherwise)
  const history = b.tasks
    .filter((x) => x.assignee === t.assignee && /complete|done|closed/.test(x.status) && x.id !== taskId)
    .map((x) => ({ title: x.title, project: x.project, minutes: tracked[x.id] ?? x.spentMin }))
    .filter((x) => x.minutes > 0)
    .slice(0, 25);
  const out = await chat(
    `Estimate how many minutes this task will take ${t.assignee}. Base it on their past tasks and actual times below; if there is no history, estimate from the task itself for a software/automation developer.\n\n` +
      `Task: ${t.title}\nProject: ${t.project}\nDescription: ${(t.description || "(none)").slice(0, 1500)}\n\n` +
      `Past tasks (title · minutes actually taken):\n${history.map((h) => `- ${h.title} · ${h.minutes}`).join("\n") || "(no history yet)"}\n\n` +
      `Return ONLY JSON: {"minutes": number, "reason": "one short sentence"}`,
    "estimate",
  );
  const r = parseJson<{ minutes: number; reason: string }>(out);
  const minutes = Math.max(5, Math.round(Number(r.minutes) || 0));
  await run(
    "insert into estimates (task_id, ai_min, ai_note, updated_at) values (?,?,?,?) on conflict (task_id) do update set ai_min = excluded.ai_min, ai_note = excluded.ai_note, updated_at = excluded.updated_at",
    taskId, minutes, r.reason ?? null, Date.now(),
  );
  return { minutes, reason: r.reason, basedOn: history.length };
}

export const getEstimate = (taskId: string) => get<Estimate>("select task_id, my_min, ai_min, ai_note from estimates where task_id = ?", taskId);
