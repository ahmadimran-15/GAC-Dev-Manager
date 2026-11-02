import { getConversation, getMessages, msgText, updateConversation } from "@/lib/store";
import { whisper, whisperConfigured } from "@/lib/stt";
import { defaultSender } from "@/lib/accounts";
import { taggablePeople } from "@/lib/whatsapp";

// Text goes to the custom Gemini web-to-API server (OpenAI-compatible). It can't take audio, so voice
// notes are transcribed by Whisper (WHISPER_API_KEY) or, failing that, the Google AI API (GOOGLE_AI_API_KEY).

// The web-to-API server answers as chat text, so every prompt says how to format the answer.
const PREFIX =
  "Ignore any earlier conversation in this session. Answer as plain text only, no markdown headings or bold. " +
  "Do not use, open or mention any apps, extensions or tools (Shopify, Gmail, Maps, Workspace…); just write the text asked for. " +
  "When asked for JSON, return it inside one ```json code block and nothing else.\n\n";

// The Gemini web app sometimes answers with its own prompts ("I'll need your permission to turn on the
// Shopify app") or talks to the manager instead of writing the message. Never let that become a reply.
const META =
  /permission to (turn on|use|connect)|turn on the \w+ (app|extension)|connect (your|the) \w+ (account|app)|here(?:'s| is) (?:a|the|your) (?:quick|short|professional|polished|draft|message|reply)|message you can send|\[client name\]|as an ai\b|i can(?:'t|not) help with/i;

// A client-facing message from Gemini: retried with a fresh session when it looks like Gemini talking to
// us instead of a message to send; refused after that.
async function clientMessage(prompt: string, session: string, background = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = strip(await chat(prompt, session, { background }));
    if (text && !META.test(text)) return text;
  }
  throw new Error("Gemini didn't return a usable message (it answered with an app or permission prompt). Try Generate again or type the reply.");
}

export const aiConfigured = () => !!(process.env.GEMINI_BASE_URL && process.env.GEMINI_API_KEY);
export const transcriptionConfigured = () => whisperConfigured() || !!process.env.GOOGLE_AI_API_KEY;

// Every call reuses ONE session (GEMINI_SESSION_ID): the server opens a new Gemini chat for each new session id
// and rate-limits that, so per-feature ids made calls fail. The prompt PREFIX makes each answer stand alone.
// Calls run one at a time so two prompts never land in that one chat together. Anything the manager clicked
// goes first; background work (estimates, auto-summaries, auto-suggestions) only runs when nobody is waiting.
type Job = { prompt: string; resolve: (s: string) => void; reject: (e: unknown) => void };
const now: Job[] = [];
const later: Job[] = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  try {
    for (let job = now.shift() ?? later.shift(); job; job = now.shift() ?? later.shift()) {
      try {
        job.resolve(await ask(job.prompt));
      } catch (e) {
        job.reject(e);
      }
    }
  } finally {
    busy = false;
  }
}
export function chat(prompt: string, _purpose = "portal", opts: { background?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    (opts.background ? later : now).push({ prompt, resolve, reject });
    pump();
  });
}
export const aiQueue = () => ({ waiting: now.length, background: later.length, busy });

async function ask(prompt: string) {
  const { GEMINI_BASE_URL, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_SESSION_ID } = process.env;
  if (!GEMINI_BASE_URL || !GEMINI_API_KEY) throw new Error("Gemini is not configured in .env");
  const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GEMINI_API_KEY}`, "X-Session-Id": GEMINI_SESSION_ID || "gac-desk" },
    // Cutting text to a length can split an emoji in half; the Gemini server rejects those broken characters
    body: JSON.stringify({ model: GEMINI_MODEL, messages: [{ role: "user", content: (PREFIX + prompt).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "") }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gemini: ${data?.error?.message ?? data?.detail ?? `error ${res.status}`}`);
  const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("Gemini returned an empty answer (it may be busy or rate-limited). Try again in a moment.");
  return text;
}

export function parseJson<T>(text: string): T {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("Gemini didn't answer in the expected format. Try again.");
  return JSON.parse(text.slice(s, e + 1)) as T;
}

const strip = (t: string) => t.replace(/^["'`]+|["'`]+$/g, "").trim();

export async function polish(text: string) {
  return clientMessage(`Fix grammar, spelling and tone of this client-facing message. Keep the meaning, keep it short, warm and professional. Return only the corrected message.\n\nMessage:\n${text}`, "polish");
}

export async function rewrite(text: string, instructions: string) {
  return clientMessage(`Rewrite this client message following the manager's instruction (it may be in English, Urdu or Hindi). Keep it short and professional, in English. Return only the final message.\n\nMessage:\n${text}\n\nInstruction:\n${instructions}`, "rewrite");
}

async function transcriptFor(convId: string, limit = 12) {
  return (await getMessages(convId))
    .slice(-limit)
    .map((m) => `${m.direction === "in" ? "Client" : "Us"}: ${msgText(m)}`)
    .join("\n");
}

// Draft the reply the manager would most likely send now, and store it on the conversation.
// background=true when drafted automatically after a client message (waits behind anything you clicked)
export async function suggestReply(convId: string, background = false) {
  const c = await getConversation(convId);
  if (!c) return null;
  const msgs = await getMessages(convId);
  const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
  const text = await clientMessage(
    `You are the project manager of a software agency replying to a client${c.project ? ` about the "${c.project}" project` : ""}. ` +
      `Write the next reply to the client's latest messages. Be short (1–3 sentences), warm and professional, in English. ` +
      `You don't know technical details, so acknowledge, say the team is on it and promise a concrete update time when it fits. ` +
      `Address them by first name. Return only the reply text.\n\nConversation:\n${await transcriptFor(convId)}`,
    `suggest-${convId}`,
    background,
  );
  await updateConversation(convId, { suggestion: text, suggestion_for: lastIn?.id ?? null });
  return text;
}

// "Generate": the manager's rough draft or instruction (typed or dictated, English/Urdu/Hindi)
// becomes the finished message. "@Name" is kept for anyone they ask to tag.
export async function generateReply(convId: string, input: string) {
  const c = await getConversation(convId);
  if (!c) throw new Error("Conversation not found");
  const group = c.channel === "whatsapp" && c.external_id.endsWith("@g.us");
  // The group's members by first name, so a spoken "tag Tulayb" comes out as the right "@Tulaib"
  let names: string[] = [];
  if (group && /\b(tag|mention)|@/i.test(input)) {
    const a = await defaultSender("whatsapp", c.account);
    const close = a ? (await taggablePeople(a, c.external_id, 3_000).catch(() => null))?.close : null;
    names = [...new Set((close ?? []).map((p) => p.name.split(/\s+/)[0]).filter((n) => n.length >= 3))].slice(0, 60);
  }
  return clientMessage(
    `You are the project manager of a software agency writing to a client${group ? " in their WhatsApp group" : ""}${c.project ? ` about the "${c.project}" project` : ""}. ` +
      (input.trim()
        ? `The manager typed or dictated this (it may be a rough draft or an instruction, in English, Urdu, Hindi or a mix):\n"${input.trim()}"\n\n` +
          `Write the final message following it. If it's a draft, keep its meaning and improve it; if it's an instruction, do what it says. ` +
          `If they ask to tag or mention someone, write @ followed by that person's first name as one word (e.g. @Tulaib) where it fits. ` +
          (names.length ? `People in this group who can be tagged (use the closest of these spellings): ${names.join(", ")}. ` : "")
        : `Write the next reply to the client's latest messages. `) +
      `Write the message itself, addressed to the client, not a note to the manager about it. Short, warm and professional, in English. Return only the message.\n\nConversation:\n${await transcriptFor(convId, 20)}`,
    `generate-${convId}`,
  );
}

// A short "what's going on here" note for the thread: who the client is, what they asked for, what our
// side (you or a teammate) already answered or promised, and what is still open. Works for every channel.
export async function summarizeConversation(convId: string, background = false) {
  const c = await getConversation(convId);
  if (!c) return null;
  const msgs = (await getMessages(convId)).slice(-40);
  if (!msgs.length) return null;
  const who = (m: (typeof msgs)[number]) =>
    m.direction === "in" ? (c.channel === "whatsapp" && /@g\.us$/.test(c.external_id) ? "Client side" : c.name) : m.sent_by && !["me", "phone"].includes(m.sent_by) ? `${m.sent_by} (our team)` : "Me (manager)";
  const transcript = msgs.map((m) => `[${new Date(Number(m.created_at)).toISOString().slice(0, 16).replace("T", " ")}] ${who(m)}: ${msgText(m).slice(0, 600)}`).join("\n");
  const text = (
    await chat(
      `Summarise this ${c.channel} conversation for a busy project manager in 3 to 5 short lines, in English. ` +
        `Say who ${c.name} is and what they want, what our side already replied or promised (name who said it), and what is still open or needs an answer. ` +
        `${c.subject ? `Email subject: ${c.subject}. ` : ""}${c.project ? `Project: ${c.project}. ` : ""}Return only the summary lines.\n\nConversation:\n${transcript}`,
      `context-${convId}`,
      { background },
    )
  ).trim();
  await updateConversation(convId, { context: text, context_at: Date.now() });
  return text;
}

// "Get context" on a ClickUp task: what it is, who asked, what was done, what's left, from the
// description and every comment (Loom links are listed separately by the caller).
export async function summarizeTask(t: { title: string; project: string; assignee: string; status: string; due: string | null; description: string; comments: { user: string; text: string; at: number }[]; looms: string[] }) {
  const comments = [...t.comments]
    .sort((a, b) => a.at - b.at)
    .map((c) => `[${new Date(c.at).toISOString().slice(0, 10)}] ${c.user}: ${c.text.slice(0, 800)}`)
    .join("\n");
  return (
    await chat(
      `Explain this ClickUp task to a busy project manager in 4 to 7 short lines, in English: what it is about and who asked for it, what has been done so far (name who did what), ` +
        `what is still open or blocked, and anything they should act on. Mention that there ${t.looms.length === 1 ? "is a Loom video" : `are ${t.looms.length} Loom videos`} if any. Return only the lines.\n\n` +
        `Task: ${t.title}\nProject: ${t.project}\nAssignee: ${t.assignee}\nStatus: ${t.status}${t.due ? `\nDue: ${t.due}` : ""}\n\nDescription:\n${t.description.slice(0, 4000) || "(none)"}\n\nComments (oldest first):\n${comments.slice(0, 10000) || "(none)"}`,
      "task-context",
    )
  ).trim();
}

export interface TicketDraft {
  title: string;
  description: string;
  checklist: string[];
  priority: "urgent" | "high" | "normal" | "low";
  project?: string | null; // exact name from the current projects, when the instructions say where it goes
  assignee?: string | null; // exact team member name, when the instructions say who does it
}

// Picks the closest name from a list ("internal task" → "Internal Tasks", "ahmed" → "Muhammad Ahmad")
function closest(value: string | null | undefined, options: string[]) {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  const exact = options.find((o) => o.toLowerCase() === v);
  if (exact) return exact;
  const words = v.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ""));
  const scored = options.map((o) => ({ o, n: words.filter((w) => o.toLowerCase().includes(w)).length })).sort((a, b) => b.n - a.n);
  return scored[0]?.n ? scored[0].o : null;
}

export async function draftTicket(messages: string[], instructions: string, project?: string, lists: { projects?: string[]; team?: string[] } = {}) {
  const projects = lists.projects ?? [];
  const team = lists.team ?? [];
  const out = await chat(
    `Create one ClickUp task from these client messages. Follow the manager's instructions exactly, including which messages to leave out (instructions may be in English, Urdu or Hindi). Write in English. ` +
      `If the instructions say which project/list the task goes in or who should do it, pick the exact name from the lists below; otherwise use null. ` +
      `Return ONLY JSON: {"title": string, "description": string, "checklist": string[], "priority": "urgent"|"high"|"normal"|"low", "project": string|null, "assignee": string|null}.\n\n` +
      `${project ? `Project of this chat: ${project}\n` : ""}Current projects: ${projects.join(" | ") || "(unknown)"}\nTeam members: ${team.join(" | ") || "(unknown)"}\n\n` +
      `Client messages:\n${messages.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\nManager instructions:\n${instructions || "(none)"}`,
    "ticket",
  );
  const t = parseJson<TicketDraft>(out);
  return { ...t, project: closest(t.project, projects), assignee: closest(t.assignee, team) };
}

export interface Command {
  intent: "reply" | "task" | "answer" | "search";
  conversation_id?: string;
  reply_text?: string;
  task?: { title: string; description: string; project?: string; assignee?: string; priority?: string };
  answer?: string;
  source?: "clickup" | "email" | "messages";
  query?: string;
}

// Turns a spoken or typed instruction into one concrete action for the manager to confirm.
export async function interpret(command: string, context: string, history: string) {
  const out = await chat(
    `You are the assistant inside a project manager's dashboard (client inbox + ClickUp). The manager said (English, Urdu, Hindi or a mix):\n"${command}"\n\n` +
      (history ? `Earlier in this chat:\n${history}\n\n` : "") +
      `Context:\n${context}\n\n` +
      `Pick ONE action. Return ONLY JSON:\n` +
      `{"intent":"reply"|"task"|"search"|"answer","conversation_id":string?,"reply_text":string?,"task":{"title":string,"description":string,"project":string?,"assignee":string?,"priority":"urgent"|"high"|"normal"|"low"}?,"source":"clickup"|"email"|"messages"?,"query":string?,"answer":string?}\n` +
      `- "reply": send a message to a client. Use the conversation_id from the context. Write reply_text in English, ready to send.\n` +
      `- "task": create a ClickUp task. New tasks can only go in a CURRENT project; use the exact project name and a team member name from the context.\n` +
      `- "search": look something up. source "clickup" for tasks, Loom videos, work updates or comments; "email" for things said in emails; "messages" for WhatsApp/Slack/Teams chats. query = the key words (names, project, topic).\n` +
      `- "answer": ONLY for facts written in the Context above (who is waiting, which stage a project is in, who owns a project). Be brief, in English.\n` +
      `Anything about what is inside a task (Loom links, comments, descriptions, progress notes) or inside emails/chats MUST be "search" — never guess links or details.`,
    "assistant",
  );
  return parseJson<Command>(out);
}

// Second step of a search: answer the manager's question from what was found.
export async function answerFrom(command: string, source: string, results: string) {
  return chat(
    `The manager asked: "${command}"\n\nSearch results from ${source}:\n${results.slice(0, 12000)}\n\n` +
      `Answer briefly in English using only these results. Write links as plain URLs (no markdown), copied exactly — Loom links first if asked for a video, then the ClickUp task link. If nothing matches, say so and suggest what to search instead.`,
    "assistant-answer",
  );
}

export async function transcribe(audio: Buffer, mime: string): Promise<string | null> {
  if (whisperConfigured()) {
    const t = await whisper(audio, mime);
    if (!t.text) return null;
    if (t.language === "english" || !aiConfigured()) return t.text;
    // Urdu / Hindi voice notes: keep the original and add an English translation underneath
    const english = await chat(`Translate this ${t.language} voice note into natural English. Return only the translation.\n\n${t.text}`, "translate").catch(() => "");
    return english ? `${t.text}\n\nEnglish: ${english.trim()}` : t.text;
  }
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) return null;
  const model = process.env.GOOGLE_AI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: "Transcribe this voice note. If it is in Urdu or Hindi, write the English translation after the transcript on a new line starting with 'English:'. Return only that." },
            { inline_data: { mime_type: mime.split(";")[0] || "audio/ogg", data: audio.toString("base64") } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `Transcription failed (${res.status})`);
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim() || null;
}
