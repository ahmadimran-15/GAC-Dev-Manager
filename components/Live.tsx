"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ConvSummary } from "@/lib/store";

export interface DraftRow {
  id: string;
  conv_id: string | null;
  project?: string | null;
  author: string;
  text: string;
  created_at: number;
  conv_name: string | null;
  channel: string | null;
}

export interface AccountLite {
  id: string;
  kind: "email" | "whatsapp";
  label: string;
  address: string;
  provider: string;
  enabled: boolean;
  canSend: boolean;
  status: { ok: boolean; at: number; error?: string } | null;
  config?: { audience?: "client" | "team"; [k: string]: unknown };
}

// The account a conversation came in on (email address or WhatsApp account id)
export const accountOf = (accounts: AccountLite[] | undefined, key: string | null | undefined) =>
  key ? accounts?.find((a) => a.id === key || a.address.toLowerCase() === key.toLowerCase()) : undefined;

export interface LiveState {
  now: number;
  me: { name: string; email: string; role: "admin" | "team" } | null;
  health: { at: number; problems: string[] } | null;
  conversations: ConvSummary[];
  drafts: DraftRow[];
  stats: { waiting: number; teamWaiting?: number; tasks?: number; firstReplyAvg: number | null; repliesToday: number };
  accounts: AccountLite[];
  connections: {
    gemini: boolean;
    transcription: boolean;
    whisper: boolean;
    stt: string;
    voiceWhisper: boolean;
    whatsapp: boolean;
    whatsappLastEvent: number | null;
    whatsappSecret: boolean;
    reminderWhatsApp: boolean;
    reminderEmail: string | null;
    publicUrl: string | null;
    clickup: boolean;
  };
  hasDemo: boolean;
}

export async function api<T = Record<string, unknown>>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: "no-store", signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("Signed out");
  }
  // A page instead of JSON = the server was restarting or the tunnel couldn't reach it
  if (!data) throw new Error(res.ok ? "Unexpected answer from the server" : `The server didn't answer (${res.status}). It may be restarting; try again in a few seconds.`);
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
  return data as T;
}

interface Ctx {
  state: LiveState | null;
  refresh: () => Promise<void>;
  toast: (text: string, tone?: "ok" | "error") => void;
  send: (convId: string, text: string, ack?: boolean, from?: string | null) => Promise<boolean>;
  openAssistant: () => void;
  assistantOpen: boolean;
  setAssistantOpen: (v: boolean) => void;
}

const LiveCtx = createContext<Ctx | null>(null);
export const useLive = () => {
  const c = useContext(LiveCtx);
  if (!c) throw new Error("useLive outside provider");
  return c;
};

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiveState | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api<LiveState>("/api/state"));
    } catch {
      /* keep last state */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const toast = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToastMsg({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const send = useCallback(
    async (convId: string, text: string, ack = false, from: string | null = null) => {
      try {
        const r = await api<{ simulated: boolean; name: string; channel: string; via: string | null; untagged?: string[] }>(`/api/conversations/${convId}`, { action: "send", text, ack, from });
        if (r.untagged?.length) toast(`Sent to ${r.name}, but couldn't tag ${r.untagged.map((n) => `@${n}`).join(", ")}: not a saved contact in this group`, "error");
        else toast(`${ack ? "Acknowledged" : "Sent to"} ${r.name}${r.via ? ` from ${r.via}` : ""}${r.simulated ? " (test mode, not delivered)" : ""}`);
        await refresh();
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Send failed", "error");
        return false;
      }
    },
    [refresh, toast],
  );

  return (
    <LiveCtx.Provider value={{ state, refresh, toast, send, assistantOpen, setAssistantOpen, openAssistant: () => setAssistantOpen(true) }}>
      {children}
      {toastMsg && (
        <div className={`fade-in fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full px-4 py-2 text-[13px] text-white shadow-lg ${toastMsg.tone === "error" ? "bg-[#c7353a]" : "bg-[#171717]"}`}>
          {toastMsg.text}
        </div>
      )}
    </LiveCtx.Provider>
  );
}
