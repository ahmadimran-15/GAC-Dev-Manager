// Speech to text through any OpenAI-compatible Whisper endpoint (Groq free tier, OpenAI, or self-hosted).
export const whisperConfigured = () => !!process.env.WHISPER_API_KEY;

export async function whisper(audio: Buffer, mime: string, language?: string): Promise<string> {
  const base = (process.env.WHISPER_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const ext = mime.includes("webm") ? "webm" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${ext}`);
  form.append("model", process.env.WHISPER_MODEL || "whisper-large-v3");
  form.append("response_format", "json");
  if (language) form.append("language", language);
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHISPER_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `Whisper error ${res.status}`);
  return String(data?.text ?? "").trim();
}
