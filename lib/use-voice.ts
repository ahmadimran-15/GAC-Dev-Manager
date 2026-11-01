"use client";
import { useRef, useState } from "react";

// Voice input in English, Urdu or Hindi. Uses Whisper on the server when it's configured
// (better for Urdu), otherwise the browser's own speech recognition (Chrome / Edge).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const VOICE_LANGS = [
  { code: "en-US", label: "English" },
  { code: "ur-PK", label: "اردو" },
  { code: "hi-IN", label: "हिन्दी" },
];

export function useVoice(onFinal: (text: string) => void, useWhisper = false) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<any>(null);

  async function startWhisper(lang: string) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      setInterim("Transcribing…");
      const form = new FormData();
      form.append("audio", new Blob(chunks, { type: mr.mimeType || "audio/webm" }), "voice.webm");
      form.append("lang", lang);
      try {
        const r = await fetch("/api/stt", { method: "POST", body: form });
        const d = await r.json();
        if (d.text) onFinal(d.text);
        else alert(d.error ?? "Couldn't transcribe");
      } finally {
        setInterim("");
      }
    };
    mr.start();
    rec.current = { stop: () => mr.state !== "inactive" && mr.stop() };
    setListening(true);
    setInterim("");
  }

  function startBrowser(lang: string) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input works in Chrome or Edge.");
      return;
    }
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let fin = "";
      let mid = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t;
        else mid += t;
      }
      if (fin) onFinal(fin.trim());
      setInterim(mid);
    };
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    r.start();
    rec.current = r;
    setListening(true);
  }

  const start = (lang: string) => (useWhisper && typeof MediaRecorder !== "undefined" ? startWhisper(lang).catch(() => alert("Microphone not available")) : startBrowser(lang));
  const stop = () => rec.current?.stop();
  return { listening, interim, start, stop };
}
