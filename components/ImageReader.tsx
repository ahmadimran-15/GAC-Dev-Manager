"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Upload, X } from "lucide-react";

// Paste, drop or pick a picture and ask about it. The file goes straight to the server, which sends it
// to the Gemini server and hands the answer back; nothing about it is kept.

const ASKS = [
  { label: "Text inside it", prompt: "Read everything written in this picture and type it out exactly, keeping the order and the layout. If there is no text, describe what the picture shows." },
  { label: "Summarise it", prompt: "Say in a few short lines what this picture shows and what matters about it." },
  { label: "Table as rows", prompt: "Pull the table out of this picture. Return it as plain rows, one per line, columns separated by ' | '. No commentary." },
  { label: "Translate to English", prompt: "Read the text in this picture and give the English translation. Return only the translation." },
];

export default function ImageReader() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [prompt, setPrompt] = useState(ASKS[0].prompt);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  const take = (f: File | null | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    setFile(f);
    setText("");
    setErr("");
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  // Ctrl+V anywhere on the page, which is how most screenshots arrive
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) take(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const read = async () => {
    if (!file || busy) return;
    setBusy(true);
    setErr("");
    setText("");
    try {
      const body = new FormData();
      body.append("image", file);
      body.append("prompt", prompt);
      const res = await fetch("/api/image", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Reading it failed (${res.status})`);
      setText(String(data.text ?? ""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reading it failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div
          className={`card flex min-h-[260px] cursor-pointer flex-col items-center justify-center overflow-hidden p-3 text-center transition ${over ? "border-[var(--ink)] bg-[var(--bg-2)]" : ""}`}
          onClick={() => pick.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files?.[0]);
          }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="max-h-[420px] w-auto rounded-lg" />
          ) : (
            <span className="text-[14px] text-[var(--ink-2)]">
              <Upload size={22} className="mx-auto mb-2 opacity-60" />
              Press <b>Ctrl+V</b> to paste a screenshot
              <br />
              or drop a file here, or click to pick one
            </span>
          )}
        </div>
        <input ref={pick} type="file" accept="image/*" className="hidden" onChange={(e) => take(e.target.files?.[0])} />
        {file && (
          <div className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--ink-2)]">
            <span className="truncate">
              {file.name || "pasted image"} · {(file.size / 1024).toFixed(0)} KB
            </span>
            <button
              className="ml-auto inline-flex items-center gap-1 hover:text-[var(--ink)]"
              onClick={() => {
                setFile(null);
                setPreview("");
                setText("");
                setErr("");
              }}
            >
              <X size={13} /> Remove
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ASKS.map((a) => (
            <button key={a.label} className={`btn btn-sm ${prompt === a.prompt ? "btn-dark" : ""}`} onClick={() => setPrompt(a.prompt)}>
              {a.label}
            </button>
          ))}
        </div>
        <textarea
          className="input min-h-[90px] resize-y text-[14px]"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What do you want to know about this picture?"
        />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn btn-dark" disabled={!file || busy} onClick={read}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null} {busy ? "Reading…" : "Read it"}
          </button>
          {err && <span className="text-[13px] text-[var(--red)]">{err}</span>}
        </div>

        {text && (
          <div className="card mt-3 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12.5px] text-[var(--ink-2)]">Answer</span>
              <button
                className="inline-flex items-center gap-1 text-[12.5px] text-[var(--ink-2)] hover:text-[var(--ink)]"
                onClick={async () => {
                  await navigator.clipboard.writeText(text).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed">{text}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
