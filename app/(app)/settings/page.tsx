"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { reminderSettings } from "@/components/Reminders";
import AccountsManager from "@/components/AccountsManager";
import HealthPanel from "@/components/HealthPanel";
import GroupsManager from "@/components/GroupsManager";
import TimeTrackingSettings from "@/components/TimeTrackingSettings";
import CurrentProjects from "@/components/CurrentProjects";
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

// Our ClickUp status webhook: registered at PUBLIC_URL on startup, or here on demand. n8n's are left alone.
function ClickUpWebhook({ publicUrl }: { publicUrl: string | null }) {
  const { toast } = useLive();
  const [info, setInfo] = useState<{ registered: { endpoint: string; at: number | null } | null; lastEvent: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<NonNullable<typeof info>>("/api/clickup").then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  const want = publicUrl ? `${publicUrl.replace(/\/$/, "")}/api/webhooks/clickup` : null;
  const stale = !!want && info?.registered?.endpoint !== want;
  return (
    <div className="mt-2 text-[12.5px] text-[var(--muted)]">
      Status webhook (two-way status sync): {info?.registered ? <code>{info.registered.endpoint}</code> : "not registered"}
      {info?.lastEvent ? ` · last event ${ago(info.lastEvent)}` : info?.registered ? " · no event yet" : ""}
      {stale && <span className="text-[var(--amber)]"> · doesn&apos;t match PUBLIC_URL</span>}
      <div className="mt-2">
        <button
          className="btn btn-sm"
          disabled={busy || !publicUrl}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ endpoint: string }>("/api/clickup", {});
              toast(`ClickUp webhook → ${r.endpoint}`);
              load();
            } catch (e) {
              toast(e instanceof Error ? e.message : "Failed", "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Registering…" : "Register ClickUp webhook"}
        </button>
        {!publicUrl && <span className="ml-2">Set PUBLIC_URL in .env first.</span>}
      </div>
    </div>
  );
}

// One section at a time, picked from the row of buttons at the top. Everything used to be on one
// page, which meant scrolling past system health to reach anything further down.
const TABS = [
  { id: "health", label: "Health" },
  { id: "projects", label: "Projects" },
  { id: "time", label: "Time tracking" },
  { id: "reminders", label: "Reminders" },
  { id: "accounts", label: "Accounts" },
  { id: "ai", label: "AI & tasks" },
  { id: "groups", label: "Groups" },
];

export default function Settings() {
  const { state, refresh, toast } = useLive();
  const [tab, setTab] = useState("health");
  const [origin, setOrigin] = useState("");
  const [every, setEvery] = useState(5);
  const [after, setAfter] = useState(2);
  const [notif, setNotif] = useState("default");

  useEffect(() => {
    setOrigin(window.location.origin);
    // /settings#health from the problem badge in the top bar still opens the right section.
    const hash = window.location.hash.replace("#", "");
    if (TABS.some((t) => t.id === hash)) setTab(hash);
    const s = reminderSettings.get();
    setEvery(s.every);
    setAfter(s.after);
    if ("Notification" in window) setNotif(Notification.permission);
  }, []);

  const k = state?.connections;
  const save = (e: number, a: number) => {
    setEvery(e);
    setAfter(a);
    reminderSettings.set(e, a);
    toast("Reminder settings saved");
  };

  return (
    <div className="fade-in mx-auto max-w-[820px] px-4 pb-20 pt-6 md:px-6 md:pt-10">
      <h1 className="text-[30px] font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-[15px] text-[var(--ink-2)]">System health, accounts, projects and reminders. Logins moved to Users.</p>

      <div className="sticky top-14 z-20 -mx-4 mb-6 mt-5 overflow-x-auto border-b border-[var(--line)] bg-[var(--bg)]/90 px-4 py-2 backdrop-blur-md md:-mx-6 md:px-6">
        <div className="flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition ${tab === t.id ? "bg-white font-medium text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]"}`}
            >
              {t.label}
              {t.id === "health" && (state?.health?.problems.length ?? 0) > 0 && (
                <span className="tnum ml-1.5 rounded-full bg-[var(--red)] px-1.5 text-[10.5px] font-semibold text-white">{state!.health!.problems.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === "health" && <HealthPanel />}

      {tab === "projects" && <CurrentProjects />}

      {tab === "time" && <TimeTrackingSettings />}

      {tab === "reminders" && (
        <>
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
          detail={k?.reminderWhatsApp ? "On. The server sends you a WhatsApp summary of waiting clients with suggested replies." : "Off — the summary comes by email instead. Set REMINDER_WHATSAPP_DIGEST=on in .env to get it on your phone as well."}
        />
        <Row
          name="Email reminders"
          ok={k?.reminderEmail ? (state?.accounts ?? []).some((a) => a.kind === "email" && a.enabled && a.status?.ok) : null}
          detail={
            k?.reminderEmail
              ? (state?.accounts ?? []).some((a) => a.kind === "email" && a.enabled && a.status?.ok)
                ? `On. The same summary goes to ${k.reminderEmail} from your first working mailbox.`
                : `Set to ${k.reminderEmail}, but no mailbox can log in yet. Fix a mailbox below.`
              : "Set REMINDER_EMAIL_TO in .env to also get the summary by email."
          }
        />
        <div className="py-3 text-[12.5px] text-[var(--muted)]">Each client can have its own reminder time: open the conversation in the inbox and pick “Remind after”.</div>
      </div>
        </>
      )}

      {tab === "accounts" && (
        <>
      <h2 id="accounts" className="mb-1 text-[13.5px] font-semibold">Mailboxes &amp; WhatsApp numbers</h2>
      <p className="mb-3 text-[13px] text-[var(--ink-2)]">Every place clients can reach the company. New messages land in your inbox only; replies are sent by this server from the account you pick. Your team never gets these passwords.</p>
      <AccountsManager />
      <div className="mt-2 text-[12.5px] text-[var(--muted)]">
        Incoming WhatsApp webhook: <code>{k?.publicUrl || origin}/api/webhooks/whatsapp</code>
        {k?.whatsappLastEvent ? ` · last message received ${ago(k.whatsappLastEvent)}` : " · no incoming message yet"}
        {!k?.publicUrl && " · set PUBLIC_URL in .env to register it"}
      </div>

      <h2 className="mb-1 mt-10 text-[13.5px] font-semibold">More channels</h2>
      <div className="card divide-y divide-[var(--line)] px-5">
        <Row name="Slack" ok={null} detail="Needs a Slack app (bot + user token). There is no QR login for Slack. I'll connect it once you create the app." />
        <Row name="Microsoft Teams & Outlook" ok={null} detail="Needs one Azure app registration (Sign in with Microsoft). Outlook no longer allows plain password login." />
      </div>
        </>
      )}

      {tab === "ai" && (
      <div className="card divide-y divide-[var(--line)] px-5">
        <Row name="Gemini (your custom server)" ok={k ? k.gemini : null} detail="Writes suggested replies, polishes messages, drafts tasks and understands voice commands." />
        <Row
          name="Speech to text"
          ok={k ? k.transcription : null}
          detail={
            k?.whisper
              ? `On · ${k.stt}. Client voice notes are transcribed (English, Urdu, Hindi); Urdu and Hindi also get an English translation. Free and offline, no API key.`
              : "Off. Set STT_PROVIDER=local in .env for free offline Whisper."
          }
        />
        <Row name="ClickUp" ok={k ? k.clickup : null} detail={k?.clickup ? "Connected. Tracks the Current Projects folder; new tasks go into the project's list there." : "Add CLICKUP_TOKEN (and CLICKUP_TEAM_ID) to .env."}>
          {k?.clickup && <ClickUpWebhook publicUrl={k.publicUrl} />}
        </Row>
      </div>
      )}

      {tab === "groups" && <GroupsManager />}

      {/* Logins, team numbers and what the team may see now live on their own page: this one was
          long enough that adding a teammate meant scrolling past everything above. */}
      <Link href="/users" className="card mt-10 flex items-center justify-between gap-4 px-5 py-4 transition hover:border-[var(--line-2)]">
        <div>
          <div className="font-medium">Users</div>
          <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">Logins, what each teammate can open, team numbers, and how much of WhatsApp the team sees.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-[var(--muted)]" />
      </Link>

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
