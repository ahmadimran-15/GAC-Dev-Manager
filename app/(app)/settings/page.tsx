"use client";
import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { reminderSettings } from "@/components/Reminders";
import { ago } from "@/components/ui";

function Row({ name, ok, detail, children }: { name: string; ok: boolean | null; detail: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-4">
      <span className="dot mt-2" style={{ background: ok === null ? "#cfcfca" : ok ? "var(--green)" : "var(--amber)" }} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{name}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--ink-2)]">{detail}</div>
        {children}
      </div>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const { toast } = useLive();
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--bg)] px-3 py-2">
      <code className="min-w-0 flex-1 truncate text-[12.5px]">{value}</code>
      <button
        className="btn btn-ghost btn-sm !h-6 !px-1.5"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          toast("Copied");
        }}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}

export default function Settings() {
  const { state, refresh, toast } = useLive();
  const [origin, setOrigin] = useState("");
  const [links, setLinks] = useState<{ name: string; token: string }[]>([]);
  const [every, setEvery] = useState(5);
  const [after, setAfter] = useState(2);
  const [notif, setNotif] = useState("default");

  useEffect(() => {
    setOrigin(window.location.origin);
    const s = reminderSettings.get();
    setEvery(s.every);
    setAfter(s.after);
    if ("Notification" in window) setNotif(Notification.permission);
    api<{ links: { name: string; token: string }[] }>("/api/team").then((r) => setLinks(r.links ?? []));
  }, []);

  const k = state?.connections;
  const save = (e: number, a: number) => {
    setEvery(e);
    setAfter(a);
    reminderSettings.set(e, a);
    toast("Reminder settings saved");
  };

  return (
    <div className="fade-in mx-auto max-w-[820px] px-6 pb-20 pt-10">
      <h1 className="text-[30px] font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-[15px] text-[var(--ink-2)]">Connections, reminders and team links. Keys live in the server&apos;s .env file.</p>

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">Reminders</h2>
      <div className="card divide-y divide-[var(--line)] px-5">
        <div className="flex flex-wrap items-center gap-3 py-4 text-[14px]">
          Remind me every
          <select className="input !w-auto !py-1" value={every} onChange={(e) => save(Number(e.target.value), after)}>
            {[1, 2, 5, 10, 15, 30].map((n) => (
              <option key={n} value={n}>
                {n} min
              </option>
            ))}
          </select>
          when a client has waited more than
          <select className="input !w-auto !py-1" value={after} onChange={(e) => save(every, Number(e.target.value))}>
            {[1, 2, 5, 10, 15, 30].map((n) => (
              <option key={n} value={n}>
                {n} min
              </option>
            ))}
          </select>
        </div>
        <Row
          name="Desktop notifications"
          ok={notif === "granted"}
          detail={notif === "granted" ? "On. You'll get a notification when the dashboard is in the background." : "Allow notifications so reminders reach you even when this tab is hidden."}
        >
          {notif !== "granted" && (
            <button className="btn btn-sm mt-2" onClick={async () => setNotif(await Notification.requestPermission())}>
              Allow notifications
            </button>
          )}
        </Row>
        <Row
          name="WhatsApp reminders to your phone"
          ok={!!k?.reminderWhatsApp && !!k?.whatsapp}
          detail={k?.reminderWhatsApp ? "On. The server sends you a WhatsApp summary of waiting clients with suggested replies." : "Set REMINDER_WHATSAPP_TO (your number) and REMINDER_MINUTES in .env to get reminders on your phone too."}
        />
      </div>

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">Channels</h2>
      <div className="card divide-y divide-[var(--line)] px-5">
        <Row
          name="WhatsApp"
          ok={k ? k.whatsappSession?.status === "ready" : null}
          detail={
            <>
              {k?.whatsappSession
                ? `Session ${k.whatsappSession.status}${k.whatsappSession.phone ? ` · +${k.whatsappSession.phone}` : ""}${k.whatsappSession.pushName ? ` (${k.whatsappSession.pushName})` : ""}.`
                : "Add WA_BASE_URL, WA_SESSION_ID and WA_API_KEY to .env."}
              {k?.whatsappLastEvent ? ` Last message received ${ago(k.whatsappLastEvent)}.` : " No incoming message received yet."}
            </>
          }
        >
          <CopyField value={`${k?.publicUrl || origin}/api/webhooks/whatsapp`} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="btn btn-sm"
              disabled={!k?.publicUrl}
              onClick={async () => {
                try {
                  const r = await api<{ url: string }>("/api/whatsapp/register", {});
                  toast(`Webhook registered: ${r.url}`);
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Failed", "error");
                }
              }}
            >
              Register webhook on the gateway
            </button>
            <span className="text-[12px] text-[var(--muted)]">{k?.publicUrl ? "Adds this dashboard next to your existing n8n webhook, with a signing secret." : "Needs a public https address: set PUBLIC_URL in .env (after hosting or a tunnel)."}</span>
          </div>
        </Row>
        <Row
          name="Email"
          ok={k ? k.email.length > 0 && k.email.every((e) => e.status?.ok !== false) : null}
          detail={
            k?.email.length ? (
              <span className="space-y-0.5">
                {k.email.map((e) => (
                  <span key={e.label} className="block">
                    <b>{e.label}</b> {e.user} · {e.status ? (e.status.ok ? `checked ${ago(e.status.at)}` : <span className="text-[var(--red)]">{e.status.error}</span>) : "connecting…"}
                  </span>
                ))}
              </span>
            ) : (
              "Add EMAIL1_PROVIDER / EMAIL1_USER / EMAIL1_PASS to .env. Titan and Zoho use your normal password; Gmail needs an App Password."
            )
          }
        />
        <Row name="Slack" ok={null} detail="Needs a Slack app (bot + user token). There is no QR login for Slack. I'll connect it once you create the app." />
        <Row name="Microsoft Teams & Outlook" ok={null} detail="Needs one Azure app registration (Sign in with Microsoft). Outlook no longer allows plain password login." />
      </div>

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">AI & tasks</h2>
      <div className="card divide-y divide-[var(--line)] px-5">
        <Row name="Gemini (your custom server)" ok={k ? k.gemini : null} detail="Writes suggested replies, polishes messages, drafts tasks and understands voice commands." />
        <Row
          name="Speech to text (Whisper)"
          ok={k ? k.transcription : null}
          detail={
            k?.whisper
              ? "On. Client voice notes and your voice commands are transcribed by Whisper (English, Urdu, Hindi)."
              : "Your Gemini web-to-API server can't read audio. Add WHISPER_API_KEY (free at console.groq.com) to transcribe client voice notes. Your own voice commands use the browser until then."
          }
        />
        <Row name="ClickUp" ok={k ? k.clickup : null} detail={k?.clickup ? "Connected. Tracks the Current Projects folder; new tasks go into the project's list there." : "Add CLICKUP_TOKEN (and CLICKUP_TEAM_ID) to .env."}>
          <div className="mt-2 text-[12.5px] text-[var(--muted)]">Status-change webhook (for the tamper-proof time log):</div>
          <CopyField value={`${origin}/api/webhooks/clickup`} />
        </Row>
      </div>

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">Team reply links</h2>
      <div className="card px-5 py-4">
        <p className="text-[13px] text-[var(--ink-2)]">Each teammate gets a private link to write client updates. Drafts come to you for approval and are sent from your account. They never see client numbers or emails. Set TEAM_TOKENS in .env.</p>
        {links.map((l) => (
          <div key={l.token} className="mt-3">
            <div className="text-[13px] font-medium">{l.name}</div>
            <CopyField value={`${origin}/team-reply/${l.token}`} />
          </div>
        ))}
      </div>

      {state?.hasDemo && (
        <>
          <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">Test data</h2>
          <div className="card flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-[13px] text-[var(--ink-2)]">The sample clients and messages are for trying the dashboard. Real messages are never affected.</p>
            <button
              className="btn btn-sm"
              onClick={async () => {
                if (!confirm("Remove all test conversations?")) return;
                await api("/api/admin/clear-demo", {});
                toast("Test data removed");
                refresh();
              }}
            >
              Clear test data
            </button>
          </div>
        </>
      )}
    </div>
  );
}
