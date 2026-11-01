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

// The team builds with Claude (AI coding), so work goes fast: estimates must be strict and low.
const STRICT =
  "Rules: this team writes code and automations WITH Claude (an AI coding assistant), so tasks go much faster than usual. Be strict and keep estimates LOW. " +
  "Guide: small fix, config change, prompt tweak or bug like an API rate-limit issue = 30–45 min; a normal feature, workflow or integration = 1–3 h; " +
  "a big multi-part build = 4–8 h at most. Tasks that are mostly waiting on the client, meetings or reviews = 15–30 min of actual work. Never pad.";

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

const saveAi = (taskId: string, minutes: number, note: string | null) =>
  run(
    "insert into estimates (task_id, ai_min, ai_note, updated_at) values (?,?,?,?) on conflict (task_id) do update set ai_min = excluded.ai_min, ai_note = excluded.ai_note, updated_at = excluded.updated_at",
    taskId, minutes, note, Date.now(),
  );

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
    `Estimate how many minutes of actual work this task will take ${t.assignee}. ${STRICT} Use their past tasks and real times below when there are any.\n\n` +
      `Task: ${t.title}\nProject: ${t.project}\nDescription: ${(t.description || "(none)").slice(0, 1500)}\n\n` +
      `Past tasks (title · minutes actually taken):\n${history.map((h) => `- ${h.title} · ${h.minutes}`).join("\n") || "(no history yet)"}\n\n` +
      `Return ONLY JSON: {"minutes": number, "reason": "one short sentence"}`,
    "estimate",
  );
  const r = parseJson<{ minutes: number; reason: string }>(out);
  const minutes = Math.max(5, Math.round(Number(r.minutes) || 0));
  await saveAi(taskId, minutes, r.reason ?? null);
  return { minutes, reason: r.reason, basedOn: history.length };
}

// Background: give every open task without an AI estimate one, 15 tasks per Gemini call (title + project only).
export async function estimateMissing(max = 60) {
  const b = await board();
  if (b.source !== "clickup" || b.error) return { estimated: 0 };
  const have = await estimatesMap();
  const todo = b.tasks.filter((t) => !/complete|done|closed/.test(t.status) && !have[t.id]?.ai_min).slice(0, max);
  let estimated = 0;
  for (let i = 0; i < todo.length; i += 15) {
    const chunk = todo.slice(i, i + 15);
    const out = await chat(
      `Estimate the minutes of actual work for each task below. ${STRICT}\n\n` +
        chunk.map((t, n) => `${n + 1}. [${t.id}] ${t.title} (project: ${t.project}; status: ${t.status})`).join("\n") +
        `\n\nReturn ONLY JSON: {"tasks": [{"id": "task id in brackets", "minutes": number, "reason": "max 12 words"}]}`,
      "estimate-batch",
      { background: true },
    ).catch(() => "");
    let list: { id: string; minutes: number; reason?: string }[] = [];
    try {
      list = parseJson<{ tasks: typeof list }>(out).tasks ?? [];
    } catch {
      continue;
    }
    for (const x of list) {
      if (!chunk.some((t) => t.id === x.id)) continue;
      const m = Math.round(Number(x.minutes) || 0);
      if (m < 5 || m > 2000) continue;
      await saveAi(x.id, m, x.reason ?? null);
      estimated++;
    }
  }
  return { estimated, open: todo.length };
}

export const getEstimate = (taskId: string) => get<Estimate>("select task_id, my_min, ai_min, ai_note from estimates where task_id = ?", taskId);
