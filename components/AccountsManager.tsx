"use client";
import { useEffect, useState } from "react";
import { AtSign, Loader2, MessageCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, useLive, type AccountLite } from "@/components/Live";
import { ago } from "@/components/ui";

interface Preset {
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  note?: string;
}

function StatusLine({ a }: { a: AccountLite }) {
  if (!a.enabled) return <span className="text-[var(--muted)]">Paused</span>;
  if (!a.status) return <span className="text-[var(--muted)]">Connecting…</span>;
  return a.status.ok ? (
    <span className="text-[var(--green)]">
      Connected · checked {ago(a.status.at)}
      {a.status.error ? <span className="text-[var(--amber)]"> · {a.status.error}</span> : null}
    </span>
  ) : (
    <span className="text-[var(--red)]">{a.status.error ?? "Not connected"}</span>
  );
}

function Row({ a, onChange, presets }: { a: AccountLite; onChange: () => void; presets: Record<string, Preset> }) {
  const { toast } = useLive();
  const [editing, setEditing] = useState(false);
  const set = async (body: Record<string, unknown>, msg?: string) => {
    try {
      await api("/api/accounts", { id: a.id, ...body });
      if (msg) toast(msg);
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  };
  return (
    <div>
    <div className="flex items-center gap-3 py-3">
      <span className="dot" style={{ background: !a.enabled ? "#cfcfca" : a.status?.ok ? "var(--green)" : a.status ? "var(--red)" : "#cfcfca" }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]">
          <span className="font-medium">{a.label}</span>
          {a.label !== a.address && <span className="text-[var(--muted)]"> · {a.kind === "whatsapp" && /^\d+$/.test(a.address) ? `+${a.address}` : a.address}</span>}
        </div>
        <div className="truncate text-[12.5px]">
          <StatusLine a={a} />
        </div>
      </div>
      <label className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-[var(--ink-2)]" title="Show this account in the From list when replying">
        <input type="checkbox" className="accent-[#171717]" checked={a.canSend} onChange={(e) => set({ action: "update", canSend: e.target.checked })} />
        Reply from
      </label>
      <label className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-[var(--ink-2)]" title="Check this account for new messages">
        <input type="checkbox" className="accent-[#171717]" checked={a.enabled} onChange={(e) => set({ action: "update", enabled: e.target.checked })} />
        Active
      </label>
      <button className={`btn btn-sm ${editing ? "btn-dark" : ""}`} onClick={() => setEditing((e) => !e)}>
        {editing ? <X size={13} /> : <Pencil size={13} />} {editing ? "Close" : "Edit"}
      </button>
      <button
        className="btn btn-ghost btn-sm !px-2"
        title="Remove"
        onClick={() => confirm(`Remove ${a.address}? Its past messages stay in the inbox.`) && set({ action: "delete" }, "Removed")}
      >
        <Trash2 size={14} />
      </button>
    </div>
      {editing &&
        (a.kind === "email" ? (
          <AddMailbox presets={presets} edit={a} onDone={() => (setEditing(false), onChange())} />
        ) : (
          <EditWhatsApp a={a} onDone={() => (setEditing(false), onChange())} />
        ))}
    </div>
  );
}

// Rename a WhatsApp number, or point it at a new gateway URL / API key (empty = keep the saved one)
function EditWhatsApp({ a, onDone }: { a: AccountLite; onDone: () => void }) {
  const { toast } = useLive();
  const [f, setF] = useState({ label: a.label, baseUrl: "", apiKey: "" });
  const [busy, setBusy] = useState(false);
  return (
    <div className="fade-in mb-3 rounded-xl bg-[var(--bg)] p-4">
      <div className="grid grid-cols-3 gap-2.5">
        <label className="block">
          <span className="eyebrow">Name</span>
          <input className="input mt-1" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </label>
        <label className="block">
          <span className="eyebrow">Gateway URL</span>
          <input className="input mt-1" placeholder="Keep current" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} />
        </label>
        <label className="block">
          <span className="eyebrow">API key</span>
          <input className="input mt-1" type="password" autoComplete="new-password" placeholder="Keep current" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          className="btn btn-dark btn-sm"
          disabled={busy || !f.label.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ status: string }>("/api/accounts", { action: "edit-whatsapp", id: a.id, ...f });
              toast(r.status === "ready" ? "Saved · connected" : `Saved · session ${r.status}`, r.status === "ready" ? "ok" : "error");
              onDone();
            } catch (e) {
              toast(e instanceof Error ? e.message : "Failed", "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Save changes
        </button>
      </div>
    </div>
  );
}

// Add a mailbox, or with `edit` change one in place (empty password = keep the saved one)
function AddMailbox({ presets, onDone, edit }: { presets: Record<string, Preset>; onDone: () => void; edit?: AccountLite }) {
  const { toast } = useLive();
  const [f, setF] = useState({
    provider: edit?.provider ?? "titan",
    address: edit?.address ?? "",
    password: "",
    label: edit && edit.label !== edit.address ? edit.label : "",
    imapHost: "",
    imapPort: "",
    smtpHost: "",
    smtpPort: "",
  });
  const [busy, setBusy] = useState<"" | "test" | "save">("");
  const [result, setResult] = useState<{ imap: string; smtp: string } | null>(null);
  const p = presets[f.provider];
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function go(action: "test-email" | "add-email" | "edit-email") {
    setBusy(action === "test-email" ? "test" : "save");
    setResult(null);
    try {
      const r = await api<{ imap?: string; smtp?: string; test?: { imap: string; smtp: string } }>("/api/accounts", { action, ...f, ...(edit ? { id: edit.id } : {}) });
      const t = r.test ?? (r.imap ? { imap: r.imap, smtp: r.smtp ?? "" } : null);
      setResult(t);
      if (action !== "test-email") {
        toast(edit ? `${f.address} saved · signed in` : `${f.address} added`);
        onDone();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="fade-in my-2 rounded-xl bg-[var(--bg)] p-4">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="eyebrow">Provider</span>
          <select className="input mt-1" value={f.provider} onChange={up("provider")}>
            {Object.entries(presets).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">Name (whose inbox is this?)</span>
          <input className="input mt-1" placeholder="e.g. Info, Dev, Tulaib's mailbox" value={f.label} onChange={up("label")} />
        </label>
        <label className="block">
          <span className="eyebrow">Email address</span>
          <input className="input mt-1" type="email" autoComplete="off" placeholder="name@getaichatbots.com" value={f.address} onChange={up("address")} />
        </label>
        <label className="block">
          <span className="eyebrow">{f.provider === "gmail" || f.provider === "yahoo" ? "App password" : "Password"}</span>
          <input className="input mt-1" type="password" autoComplete="new-password" placeholder={edit ? "Leave empty to keep the saved one" : ""} value={f.password} onChange={up("password")} />
        </label>
        {f.provider === "custom" && (
          <>
            <input className="input" placeholder="IMAP host (e.g. imap.example.com)" value={f.imapHost} onChange={up("imapHost")} />
            <input className="input" placeholder="IMAP port (993)" value={f.imapPort} onChange={up("imapPort")} />
            <input className="input" placeholder="SMTP host (e.g. smtp.example.com)" value={f.smtpHost} onChange={up("smtpHost")} />
            <input className="input" placeholder="SMTP port (465 or 587)" value={f.smtpPort} onChange={up("smtpPort")} />
          </>
        )}
      </div>
      {p?.note && <p className="mt-2.5 text-[12.5px] text-[var(--amber)]">{p.note}</p>}
      {result && (
        <div className="mt-3 space-y-0.5 text-[12.5px]">
          <div className={result.imap.startsWith("OK") ? "text-[var(--green)]" : "text-[var(--red)]"}>Reading mail: {result.imap}</div>
          <div className={result.smtp === "OK" ? "text-[var(--green)]" : "text-[var(--red)]"}>Sending mail: {result.smtp}</div>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn btn-sm" disabled={!!busy || !f.address || !f.password} onClick={() => go("test-email")} title={edit && !f.password ? "Type the password to test it, or press Save changes (it tests the saved one)" : undefined}>
          {busy === "test" && <Loader2 size={13} className="animate-spin" />} Test connection
        </button>
        <button className="btn btn-dark btn-sm" disabled={!!busy || !f.address || (!edit && !f.password)} onClick={() => go(edit ? "edit-email" : "add-email")}>
          {busy === "save" && <Loader2 size={13} className="animate-spin" />} {edit ? "Save changes" : "Save mailbox"}
        </button>
      </div>
    </div>
  );
}

function AddWhatsApp({ defaultUrl, onDone }: { defaultUrl: string; onDone: () => void }) {
  const { toast } = useLive();
  const [baseUrl, setBaseUrl] = useState(defaultUrl);
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [sessions, setSessions] = useState<{ id: string; name: string; phone: string; status: string; pushName: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const r = await api<{ sessions: typeof sessions }>("/api/accounts", { action: "wa-sessions", baseUrl, apiKey });
      setSessions(r.sessions ?? []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const s = sessions?.find((x) => x.id === pick);
    if (!s) return;
    setBusy(true);
    try {
      await api("/api/accounts", { action: "add-whatsapp", baseUrl, apiKey, sessionId: s.id, phone: s.phone, label: label || s.name || s.pushName || s.phone });
      toast("WhatsApp number added");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-in my-2 rounded-xl bg-[var(--bg)] p-4">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="eyebrow">Gateway URL</span>
          <input className="input mt-1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://ahmad-wasender.duckdns.org" />
        </label>
        <label className="block">
          <span className="eyebrow">API key</span>
          <input className="input mt-1" type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </label>
      </div>
      {sessions && (
        <div className="mt-3 space-y-1">
          {sessions.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-white">
              <input type="radio" name="wa-session" className="accent-[#171717]" checked={pick === s.id} onChange={() => setPick(s.id)} />
              <span className="font-medium">{s.name || s.pushName || "Session"}</span>
              <span className="text-[var(--muted)]">{s.phone ? `+${s.phone}` : ""} · {s.status}</span>
            </label>
          ))}
          {!sessions.length && <p className="text-[13px] text-[var(--muted)]">No sessions on this gateway for that key.</p>}
          <input className="input mt-2" placeholder="Name for this number (e.g. Company WhatsApp)" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn btn-sm" disabled={busy || !baseUrl || !apiKey} onClick={load}>
          {busy && !sessions && <Loader2 size={13} className="animate-spin" />} Load sessions
        </button>
        <button className="btn btn-dark btn-sm" disabled={busy || !pick} onClick={add}>
          Add number
        </button>
      </div>
    </div>
  );
}

export default function AccountsManager() {
  const { state, refresh, toast } = useLive();
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [adding, setAdding] = useState<"" | "email" | "whatsapp">("");
  const accounts = state?.accounts ?? [];
  const emails = accounts.filter((a) => a.kind === "email");
  const was = accounts.filter((a) => a.kind === "whatsapp");

  useEffect(() => {
    api<{ presets: Record<string, Preset> }>("/api/accounts").then((r) => setPresets(r.presets));
  }, []);

  const done = () => {
    setAdding("");
    refresh();
  };

  return (
    <div className="card px-5 py-2">
      <div className="flex items-center justify-between pt-3">
        <div className="flex items-center gap-2 font-medium">
          <AtSign size={15} className="text-[#d0590f]" /> Mailboxes <span className="tnum font-normal text-[var(--muted)]">{emails.length}</span>
        </div>
        <button className="btn btn-sm" onClick={() => setAdding(adding === "email" ? "" : "email")}>
          {adding === "email" ? <X size={13} /> : <Plus size={13} />} {adding === "email" ? "Cancel" : "Add mailbox"}
        </button>
      </div>
      {adding === "email" && <AddMailbox presets={presets} onDone={done} />}
      <div className="divide-y divide-[var(--line)]">
        {emails.map((a) => (
          <Row key={a.id} a={a} onChange={refresh} presets={presets} />
        ))}
        {!emails.length && adding !== "email" && <p className="py-3 text-[13px] text-[var(--muted)]">No mailboxes yet. Add yours, info@, dev@ and each teammate&apos;s inbox.</p>}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-[var(--line)] pt-4">
        <div className="flex items-center gap-2 font-medium">
          <MessageCircle size={15} className="text-[#1fa855]" /> WhatsApp numbers <span className="tnum font-normal text-[var(--muted)]">{was.length}</span>
        </div>
        <div className="flex gap-2">
          {was.length > 0 && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={!state?.connections.publicUrl}
              title={state?.connections.publicUrl ? "Point every number's incoming messages at this dashboard" : "Set PUBLIC_URL in .env first"}
              onClick={async () => {
                try {
                  const r = await api<{ url: string; count: number }>("/api/accounts", { action: "register-webhook" });
                  toast(`Webhook registered on ${r.count} number${r.count === 1 ? "" : "s"}`);
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Failed", "error");
                }
              }}
            >
              Register webhook
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAdding(adding === "whatsapp" ? "" : "whatsapp")}>
            {adding === "whatsapp" ? <X size={13} /> : <Plus size={13} />} {adding === "whatsapp" ? "Cancel" : "Add number"}
          </button>
        </div>
      </div>
      {adding === "whatsapp" && <AddWhatsApp defaultUrl={was.length ? "https://ahmad-wasender.duckdns.org" : ""} onDone={done} />}
      <div className="divide-y divide-[var(--line)] pb-2">
        {was.map((a) => (
          <Row key={a.id} a={a} onChange={refresh} presets={presets} />
        ))}
        {!was.length && adding !== "whatsapp" && <p className="py-3 text-[13px] text-[var(--muted)]">No WhatsApp numbers yet.</p>}
      </div>
    </div>
  );
}
