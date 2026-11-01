"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Mic, Search, Square, TriangleAlert } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { Channel } from "@/components/ui";
import { VOICE_LANGS, useVoice } from "@/lib/use-voice";

interface Result {
  intent: "reply" | "task" | "answer";
  conversation?: { id: string; name: string; channel: string } | null;
  reply_text?: string;
  task?: { title: string; description: string; project?: string; assignee?: string; priority?: string };
  answer?: string;
  warning?: string | null;
  searched?: { source: string; query: string };
  done?: string;
}

interface Turn {
  q: string;
  r?: Result;
  error?: string;
}

const EXAMPLES = [
  "Find the Loom in the ClickUp task for Aman",
  "Which projects are pending from the client?",
  "Reply to Mark that the CSV fix goes live tonight",
  "Search emails for the invoice John asked about",
  "Create a task in MI Optica Project for Hassan to fix the checkout",
];

// Links in answers become clickable
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" className="break-all text-[var(--blue)] underline underline-offset-2">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function Assistant() {
  const { assistantOpen, setAssistantOpen, send, toast, state } = useLive();
  const [text, setText] = useState("");
  const [lang, setLang] = useState("en-US");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [board, setBoard] = useState<{ team: string[]; projects: string[] } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const voice = useVoice((t) => setText((p) => (p ? `${p} ${t}` : t)), !!state?.connections.voiceWhisper);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !el.closest("input, textarea, select")) {
        e.preventDefault();
        setAssistantOpen(true);
      }
      if (e.key === "Escape") setAssistantOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setAssistantOpen]);

  useEffect(() => {
    if (assistantOpen) {
      setTimeout(() => inputRef.current?.focus(), 30);
      if (!board) api<{ team: string[]; projects: string[] }>("/api/team").then(setBoard).catch(() => {});
    } else voice.stop();
  }, [assistantOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  if (!assistantOpen) return null;

  const update = (i: number, r: Partial<Result>) => setTurns((ts) => ts.map((t, j) => (j === i ? { ...t, r: { ...t.r!, ...r } } : t)));

  async function run(q = text) {
    if (!q.trim() || busy) return;
    voice.stop();
    setText("");
    const history = turns.flatMap((t) => [`Manager: ${t.q}`, `Assistant: ${t.r?.answer ?? t.r?.done ?? t.r?.intent ?? t.error ?? ""}`]);
    setTurns((ts) => [...ts, { q }]);
    setBusy(true);
    try {
      const r = await api<Result>("/api/assistant", { text: q, history });
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, r } : t)));
    } catch (e) {
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: e instanceof Error ? e.message : "Failed" } : t)));
    } finally {
      setBusy(false);
    }
  }

  async function createTask(i: number, task: NonNullable<Result["task"]>) {
    setBusy(true);
    try {
      const r = await api<{ simulated: boolean; url: string | null; createdProject: boolean }>("/api/tasks", task);
      update(i, { done: r.simulated ? "Task ready (test mode, ClickUp not connected)" : `Created in ClickUp${r.createdProject ? ` as a new project "${task.project}"` : ""}: ${r.url}` });
    } catch (e) {
      toast(e instanceof Error ? e.message : "ClickUp failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/20 px-4 pt-[8vh] backdrop-blur-[2px]" onClick={() => setAssistantOpen(false)}>
      <div className="pop-in flex max-h-[84vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)]" onClick={(e) => e.stopPropagation()}>
        {/* Conversation */}
        <div className="scroll min-h-0 flex-1 bg-[var(--bg)] px-5 py-4">
          {!turns.length && (
            <div className="space-y-1">
              <div className="eyebrow mb-1.5">Ask me to find, reply or create. Speak in English, Urdu or Hindi.</div>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] text-[var(--ink-2)] hover:bg-white" onClick={() => run(ex)}>
                  <Search size={13} className="text-[var(--muted)]" /> {ex}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="mb-4">
              <div className="mb-2 flex justify-end">
                <div dir="auto" className="max-w-[85%] rounded-2xl rounded-br-md bg-[#171717] px-3.5 py-2 text-[14px] text-white">
                  {t.q}
                </div>
              </div>
              {!t.r && !t.error && (
                <div className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
                  <Loader2 size={14} className="animate-spin" /> Working on it…
                </div>
              )}
              {t.error && <div className="text-[13px] text-[var(--red)]">{t.error}</div>}
              {t.r && (
                <div className="fade-in rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-[0_0_0_1px_var(--line)]">
                  {t.r.searched && <div className="eyebrow mb-1.5">Searched {t.r.searched.source === "clickup" ? "ClickUp" : t.r.searched.source} for “{t.r.searched.query}”</div>}
                  {t.r.done && <p className="text-[14px] leading-relaxed"><Linked text={t.r.done} /></p>}

                  {!t.r.done && t.r.intent === "reply" && t.r.conversation && (
                    <>
                      <div className="mb-2 flex items-center gap-2 text-[13px] text-[var(--ink-2)]">
                        Reply to <b className="text-[var(--ink)]">{t.r.conversation.name}</b> on <Channel c={t.r.conversation.channel} />
                      </div>
                      <textarea className="input min-h-[80px] text-[14px] leading-relaxed" value={t.r.reply_text ?? ""} onChange={(e) => update(i, { reply_text: e.target.value })} />
                      <div className="mt-2 flex justify-end">
                        <button
                          className="btn btn-dark btn-sm"
                          disabled={busy || !t.r.reply_text?.trim()}
                          onClick={async () => {
                            if (await send(t.r!.conversation!.id, t.r!.reply_text!.trim())) update(i, { done: `Sent to ${t.r!.conversation!.name}.` });
                          }}
                        >
                          Send reply
                        </button>
                      </div>
                    </>
                  )}

                  {!t.r.done && t.r.intent === "task" && t.r.task && (
                    <div className="space-y-2">
                      <div className="text-[13px] text-[var(--ink-2)]">New ClickUp task</div>
                      {t.r.warning && (
                        <div className="flex items-start gap-2 rounded-lg bg-[#fdf3e1] px-3 py-2 text-[12.5px] text-[#9a6206]">
                          <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {t.r.warning}
                        </div>
                      )}
                      <input className="input font-medium" value={t.r.task.title} onChange={(e) => update(i, { task: { ...t.r!.task!, title: e.target.value } })} />
                      <textarea className="input min-h-[64px] text-[13.5px]" value={t.r.task.description} onChange={(e) => update(i, { task: { ...t.r!.task!, description: e.target.value } })} />
                      <div className="grid grid-cols-3 gap-2">
                        <input className="input" list="asst-projects" placeholder="Project" value={t.r.task.project ?? ""} onChange={(e) => update(i, { task: { ...t.r!.task!, project: e.target.value }, warning: null })} />
                        <datalist id="asst-projects">{board?.projects.map((p) => <option key={p} value={p} />)}</datalist>
                        <input className="input" list="asst-team" placeholder="Assignee" value={t.r.task.assignee ?? ""} onChange={(e) => update(i, { task: { ...t.r!.task!, assignee: e.target.value } })} />
                        <datalist id="asst-team">{board?.team.map((p) => <option key={p} value={p} />)}</datalist>
                        <select className="input" value={t.r.task.priority ?? "normal"} onChange={(e) => update(i, { task: { ...t.r!.task!, priority: e.target.value } })}>
                          {["urgent", "high", "normal", "low"].map((p) => <option key={p}>{p}</option>)}
                        </select>
                      </div>
                      {t.r.task.project && board && !board.projects.some((p) => p.toLowerCase() === t.r!.task!.project!.toLowerCase()) && !t.r.warning && (
                        <div className="text-[12px] text-[var(--muted)]">“{t.r.task.project}” isn&apos;t a current project yet. It will be created as a new list in Current Projects.</div>
                      )}
                      <div className="flex justify-end">
                        <button className="btn btn-dark btn-sm" disabled={busy || !t.r.task.title || !t.r.task.project || !!t.r.warning} onClick={() => createTask(i, t.r!.task!)}>
                          Create in ClickUp
                        </button>
                      </div>
                    </div>
                  )}

                  {!t.r.done && (t.r.intent === "answer" || (t.r.intent === "reply" && !t.r.conversation)) && (
                    <p dir="auto" className="whitespace-pre-wrap text-[14px] leading-relaxed">
                      <Linked text={t.r.answer || "I couldn't tell which client you meant. Try saying their name."} />
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="border-t border-[var(--line)] px-4 pb-3 pt-3">
          <div className="flex items-end gap-2.5">
            <button
              onClick={() => (voice.listening ? voice.stop() : voice.start(lang))}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition ${voice.listening ? "pulse-ring bg-[var(--red)] text-white" : "bg-[#171717] text-white hover:bg-[#2e2e2e]"}`}
              title={voice.listening ? "Stop" : "Speak"}
            >
              {voice.listening ? <Square size={14} fill="currentColor" /> : <Mic size={17} />}
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              dir="auto"
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-snug outline-none placeholder:text-[var(--muted)]"
              placeholder={voice.listening ? "Listening…" : voice.interim || "Ask, find, reply or create a task"}
              value={voice.interim && voice.listening ? `${text} ${voice.interim}`.trim() : text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  run();
                }
              }}
            />
            <button className="btn btn-dark !h-10 !w-10 !rounded-full !p-0" disabled={busy || !text.trim()} onClick={() => run()}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1 pl-12">
            {VOICE_LANGS.map((l) => (
              <button key={l.code} onClick={() => setLang(l.code)} className={`rounded-full px-2.5 py-0.5 text-[12px] ${lang === l.code ? "bg-[#171717] text-white" : "text-[var(--ink-2)] hover:bg-[var(--hover)]"}`}>
                {l.label}
              </button>
            ))}
            <span className="ml-auto text-[11.5px] text-[var(--muted)]">{state?.connections.voiceWhisper ? "Whisper" : "Browser"} voice · Enter to send · Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
