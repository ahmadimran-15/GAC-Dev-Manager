import { spawn } from "child_process";
import path from "path";
import { DATA_DIR } from "@/lib/db";

// Speech to text. Default: open-source Whisper running inside this server (free, offline after the
// one-time model download). Optional: any OpenAI-compatible Whisper API via WHISPER_API_KEY.
//   STT_PROVIDER=local | api | off      LOCAL_WHISPER_MODEL=onnx-community/whisper-base (or -small, -tiny)

const provider = () => (process.env.STT_PROVIDER || (process.env.WHISPER_API_KEY ? "api" : "local")).toLowerCase();
export const whisperConfigured = () => provider() === "local" || (provider() === "api" && !!process.env.WHISPER_API_KEY);
export const sttLabel = () => (provider() === "api" ? "Whisper API" : provider() === "local" ? `Local Whisper (${(process.env.LOCAL_WHISPER_MODEL || "onnx-community/whisper-base").split("/").pop()})` : "off");

export interface Transcript {
  text: string;
  language: string; // english | urdu | hindi | ...
}

export async function whisper(audio: Buffer, mime: string, language?: string): Promise<Transcript> {
  if (provider() === "api") return whisperApi(audio, mime, language);
  if (provider() === "local") return enqueue(() => whisperLocal(audio, language));
  throw new Error("Speech to text is off (STT_PROVIDER=off)");
}

// ---------- Remote API (Groq / OpenAI / self-hosted) ----------

async function whisperApi(audio: Buffer, mime: string, language?: string): Promise<Transcript> {
  const base = (process.env.WHISPER_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const ext = mime.includes("webm") ? "webm" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${ext}`);
  form.append("model", process.env.WHISPER_MODEL || "whisper-large-v3");
  form.append("response_format", "verbose_json");
  if (language) form.append("language", language.slice(0, 2));
  const res = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.WHISPER_API_KEY}` }, body: form, signal: AbortSignal.timeout(90_000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? `Whisper error ${res.status}`);
  return { text: String(data?.text ?? "").trim(), language: String(data?.language ?? "english").toLowerCase() };
}

// ---------- Local open-source Whisper ----------

// Plain Node require (kept out of the bundler) to find the bundled ffmpeg binary
const req = (process.getBuiltinModule("module") as typeof import("module")).createRequire(path.join(process.cwd(), "package.json"));

// Any audio (WhatsApp ogg/opus, browser webm, mp3) → 16 kHz mono float samples
function decode(audio: Buffer): Promise<Float32Array> {
  const bin = process.env.FFMPEG_PATH || (req("ffmpeg-static") as string);
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"]);
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed: ${err.slice(0, 200)}`));
      const buf = Buffer.concat(out);
      const copy = new Uint8Array(buf.byteLength);
      copy.set(buf);
      resolve(new Float32Array(copy.buffer));
    });
    p.stdin.on("error", () => {});
    p.stdin.end(audio);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Asr = any;
const g = globalThis as unknown as { __gacAsr?: Promise<Asr> | null; __gacAsrTimer?: NodeJS.Timeout; __gacSttQueue?: Promise<unknown> };

function loadModel(): Promise<Asr> {
  if (!g.__gacAsr) {
    g.__gacAsr = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = path.join(DATA_DIR, "models");
      return pipeline("automatic-speech-recognition", process.env.LOCAL_WHISPER_MODEL || "onnx-community/whisper-base", { dtype: "q8" });
    })();
    g.__gacAsr.catch(() => (g.__gacAsr = null));
  }
  // Free the memory again after a quiet spell (matters on a 1 GB server)
  clearTimeout(g.__gacAsrTimer);
  g.__gacAsrTimer = setTimeout(async () => {
    const m = await g.__gacAsr?.catch(() => null);
    g.__gacAsr = null;
    await m?.dispose?.().catch(() => {});
  }, Number(process.env.STT_IDLE_MINUTES ?? 10) * 60_000);
  return g.__gacAsr;
}

// Whisper in Transformers.js always assumes English, so pick the most likely language ourselves
async function detectLanguage(asr: Asr, audio: Float32Array, allowed: string[]) {
  const { Tensor } = await import("@huggingface/transformers");
  const id = (t: string) => asr.tokenizer.convert_tokens_to_ids([t])[0] as number;
  const codes: Record<string, string> = { english: "en", urdu: "ur", hindi: "hi", arabic: "ar", punjabi: "pa", spanish: "es", french: "fr", german: "de" };
  const inputs = await asr.processor(audio.slice(0, 16000 * 30));
  const out = await asr.model({ ...inputs, decoder_input_ids: new Tensor("int64", BigInt64Array.from([BigInt(id("<|startoftranscript|>"))]), [1, 1]) });
  const V = out.logits.dims.at(-1);
  const last = out.logits.data.slice(out.logits.data.length - V);
  let best = allowed[0];
  let bestScore = -Infinity;
  for (const lang of allowed) {
    const code = codes[lang];
    if (!code) continue;
    const s = last[id(`<|${code}|>`)];
    if (s > bestScore) {
      bestScore = s;
      best = lang;
    }
  }
  return best;
}

async function whisperLocal(audio: Buffer, language?: string): Promise<Transcript> {
  const samples = await decode(audio);
  if (samples.length < 1600) return { text: "", language: "english" };
  const asr = await loadModel();
  const allowed = (process.env.STT_LANGUAGES || "english,urdu,hindi").split(",").map((s) => s.trim().toLowerCase());
  const named: Record<string, string> = { en: "english", ur: "urdu", hi: "hindi" };
  const lang = language ? (named[language.slice(0, 2)] ?? language) : await detectLanguage(asr, samples, allowed);
  const r = await asr(samples, { language: lang, task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
  return { text: String(r?.text ?? "").trim(), language: lang };
}

// One transcription at a time keeps memory flat
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = (g.__gacSttQueue ?? Promise.resolve()).then(job, job);
  g.__gacSttQueue = run.catch(() => {});
  return run;
}
