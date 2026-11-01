"use client";
import { useState } from "react";
import { Loader2, Mic, Sparkles, Square, X } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { VOICE_LANGS, useVoice } from "@/lib/use-voice";

export interface BoardLite {
  team: string[];
  projects: string[];
  source: string;
  tasks?: { id: string; status: string }[];
}

// Turn selected client messages into a ClickUp task, with spoken or typed instructions.
// With convId the task is linked to the conversation and the picked messages.
export default function TaskDrawer({
  messages,
  project: initialProject,
  board,
  onClose,
  convId,
  messageIds,
  onCreated,
}: {
  messages: string[];
  project: string | null;
  board: BoardLite | null;
  onClose: () => void;
  convId?: string;
  messageIds?: string[];
  onCreated?: () => void;
}) {
  const { toast, state } = useLive();
  const [instructions, setInstructions] = useState("");
  const [lang, setLang] = useState("en-US");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState(initialProject ?? "");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const voice = useVoice((t) => setInstructions((p) => (p ? `${p} ${t}` : t)), !!state?.connections.voiceWhisper);

  async function draft() {
    setBusy(true);
    try {
      const { ticket } = await api<{ ticket: { title: string; description: string; checklist: string[]; priority: string } }>("/api/ai", { mode: "ticket", messages, instructions, project });
      setTitle(ticket.title);
      setDescription([ticket.description, ...(ticket.checklist?.length ? ["", ...ticket.checklist.map((c) => `- [ ] ${c}`)] : [])].join("\n"));
      setPriority(ticket.priority ?? "normal");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gemini failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ simulated: boolean }>("/api/tasks", { title, description, project, assignee, priority, due, conv_id: convId, message_ids: messageIds });
      toast(r.simulated ? "Task ready (test mode: add CLICKUP_TOKEN to create it in ClickUp)" : "Task created in ClickUp");
      onCreated?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ClickUp failed", "error");
    } finally {
      setBusy(false);
    }
  }

  const projects = board?.projects ?? [];
  const isNewProject = !!project.trim() && board?.source === "clickup" && !projects.some((p) => p.toLowerCase() === project.trim().toLowerCase());

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/15" onClick={onClose}>
      <aside className="slide-in flex h-full w-[480px] max-w-full flex-col border-l border-[var(--line)] bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5">
          <div className="text-[16px] font-semibold">New task</div>
          <button className="btn btn-ghost !h-8 !w-8 !p-0" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="scroll flex-1 space-y-5 px-6 pb-6">
          <div>
            <div className="eyebrow mb-2">From {messages.length} message{messages.length === 1 ? "" : "s"}</div>
            <div className="space-y-1.5">
              {messages.map((m, i) => (
                <p key={i} dir="auto" className="border-l-2 border-[var(--line-2)] pl-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
                  {m}
                </p>
              ))}
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2">Your instructions</div>
            <div className="rounded-xl border border-[var(--line-2)] focus-within:border-[#a8a8a2]">
              <textarea
                dir="auto"
                rows={3}
                className="w-full resize-none rounded-xl bg-transparent px-3 pt-2.5 text-[14px] outline-none placeholder:text-[var(--muted)]"
                placeholder="e.g. one bug task, high priority, give it to TuLab, ask the client for a screen recording"
                value={voice.interim ? `${instructions} ${voice.interim}` : instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <div className="flex items-center gap-1 px-2 pb-2">
                <button className={`grid h-7 w-7 place-items-center rounded-full ${voice.listening ? "pulse-ring bg-[var(--red)] text-white" : "bg-[#171717] text-white"}`} onClick={() => (voice.listening ? voice.stop() : voice.start(lang))}>
                  {voice.listening ? <Square size={10} fill="currentColor" /> : <Mic size={13} />}
                </button>
                {VOICE_LANGS.map((l) => (
                  <button key={l.code} onClick={() => setLang(l.code)} className={`rounded-full px-2 text-[11.5px] ${lang === l.code ? "bg-[var(--hover)] font-medium" : "text-[var(--muted)]"}`}>
                    {l.label}
                  </button>
                ))}
                <button className="btn btn-sm ml-auto" disabled={busy} onClick={draft}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Draft with Gemini
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <input className="input font-medium" placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="input min-h-[120px] text-[13.5px] leading-relaxed" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="eyebrow">Project</span>
              <input className="input mt-1" list="projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Current project" />
              <datalist id="projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
              {isNewProject && <span className="mt-1 block text-[11.5px] text-[var(--amber)]">New project: a list will be created in Current Projects</span>}
            </label>
            <label className="block">
              <span className="eyebrow">Assignee</span>
              <select className="input mt-1" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {board?.team.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">Priority</span>
              <select className="input mt-1" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {["urgent", "high", "normal", "low"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">Deadline</span>
              <input className="input mt-1" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--line)] px-6 py-4">
          <span className="text-[12px] text-[var(--muted)]">{board?.source === "clickup" ? "Creates the task in ClickUp" : "Test mode until ClickUp is connected"}</span>
          <button className="btn btn-dark" disabled={busy || !title.trim() || !project.trim()} onClick={create}>
            Create task
          </button>
        </div>
      </aside>
    </div>
  );
}
