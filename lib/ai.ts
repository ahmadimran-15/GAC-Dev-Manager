import { getConversation, getMessages, msgText, updateConversation } from "@/lib/store";
import { whisper, whisperConfigured } from "@/lib/stt";

// Text goes to the custom Gemini web-to-API server (OpenAI-compatible). It can't take audio, so voice
// notes are transcribed by Whisper (WHISPER_API_KEY) or, failing that, the Google AI API (GOOGLE_AI_API_KEY).

// The web-to-API server answers as chat text, so every prompt says how to format the answer.
const PREFIX =
  "Ignore any earlier conversation in this session. Answer as plain text only, no markdown headings or bold. " +
  "When asked for JSON, return it inside one ```json code block and nothing else.\n\n";

export const aiConfigured = () => !!(process.env.GEMINI_BASE_URL && process.env.GEMINI_API_KEY);
export const transcriptionConfigured = () => whisperConfigured() || !!process.env.GOOGLE_AI_API_KEY;

export async function chat(prompt: string, session = "portal") {
  const { GEMINI_BASE_URL, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_SESSION_ID } = process.env;
  if (!GEMINI_BASE_URL || !GEMINI_API_KEY) throw new Error("Gemini is not configured in .env");
  const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GEMINI_API_KEY}`, "X-Session-Id": `${GEMINI_SESSION_ID ?? "gac"}-${session}` },
    body: JSON.stringify({ model: GEMINI_MODEL, messages: [{ role: "user", content: PREFIX + prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `Gemini error ${res.status}`);
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

export function parseJson<T>(text: string): T {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  return JSON.parse(text.slice(s, e + 1)) as T;
}

const strip = (t: string) => t.replace(/^["'`]+|["'`]+$/g, "").trim();

export async function polish(text: string) {
  return strip(await chat(`Fix grammar, spelling and tone of this client-facing message. Keep the meaning, keep it short, warm and professional. Return only the corrected message.\n\nMessage:\n${text}`, "polish"));
}

export async function rewrite(text: string, instructions: string) {
  return strip(await chat(`Rewrite this client message following the manager's instruction (it may be in English, Urdu or Hindi). Keep it short and professional, in English. Return only the final message.\n\nMessage:\n${text}\n\nInstruction:\n${instructions}`, "rewrite"));
}

function transcriptFor(convId: string, limit = 12) {
  return getMessages(convId)
    .slice(-limit)
    .map((m) => `${m.direction === "in" ? "Client" : "Us"}: ${msgText(m)}`)
    .join("\n");
}

// Draft the reply the manager would most likely send now, and store it on the conversation.
export async function suggestReply(convId: string) {
  const c = getConversation(convId);
  if (!c) return null;
  const msgs = getMessages(convId);
  const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
  const text = strip(
    await chat(
      `You are the project manager of a software agency replying to a client${c.project ? ` about the "${c.project}" project` : ""}. ` +
        `Write the next reply to the client's latest messages. Be short (1–3 sentences), warm and professional, in English. ` +
        `You don't know technical details, so acknowledge, say the team is on it and promise a concrete update time when it fits. ` +
        `Address them by first name. Return only the reply text.\n\nConversation:\n${transcriptFor(convId)}`,
      `suggest-${convId}`,
    ),
  );
  updateConversation(convId, { suggestion: text, suggestion_for: lastIn?.id ?? null });
  return text;
}

export interface TicketDraft {
  title: string;
  description: string;
  checklist: string[];
  priority: "urgent" | "high" | "normal" | "low";
}

export async function draftTicket(messages: string[], instructions: string, project?: string) {
  const out = await chat(
    `Create one ClickUp task from these client messages. Follow the manager's instructions exactly, including which messages to leave out (instructions may be in English, Urdu or Hindi). Write in English. ` +
      `Return ONLY JSON: {"title": string, "description": string, "checklist": string[], "priority": "urgent"|"high"|"normal"|"low"}.\n\n` +
      `${project ? `Project: ${project}\n\n` : ""}Client messages:\n${messages.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\nManager instructions:\n${instructions || "(none)"}`,
    "ticket",
  );
  return parseJson<TicketDraft>(out);
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
