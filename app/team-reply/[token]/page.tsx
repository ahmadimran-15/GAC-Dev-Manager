"use client";
import { use, useEffect, useState } from "react";

// Public page for teammates. Shows client first names and projects only, never contact details.
export default function TeamReply({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<{ member: string; clients: { id: string; label: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [conv, setConv] = useState("");
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/team-drafts?token=${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setError("This link isn't valid. Ask your manager for a new one.")))
      .catch(() => setError("Couldn't load. Try again."));
  }, [token]);

  async function submit() {
    setBusy(true);
    const r = await fetch("/api/team-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, conv_id: conv, text }) });
    setBusy(false);
    if (r.ok) {
      setSent(true);
      setText("");
    } else setError((await r.json().catch(() => ({}))).error ?? "Failed");
  }

  return (
    <div className="mx-auto max-w-[520px] px-6 py-16">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#171717] text-[14px] font-bold text-white">G</span>
      {error && <p className="mt-8 text-[var(--red)]">{error}</p>}
      {info && (
        <>
          <h1 className="mt-6 text-[24px] font-semibold tracking-tight">Hi {info.member.split(" ")[0]}, write a client update</h1>
          <p className="mt-1 text-[14px] text-[var(--ink-2)]">Your manager checks it and sends it to the client from their account.</p>
          {sent ? (
            <div className="card mt-8 p-6">
              <div className="font-medium">Sent for approval ✓</div>
              <p className="mt-1 text-[14px] text-[var(--ink-2)]">You&apos;ll see it go out once it&apos;s approved.</p>
              <button className="btn btn-sm mt-4" onClick={() => setSent(false)}>
                Write another
              </button>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              <select className="input" value={conv} onChange={(e) => setConv(e.target.value)}>
                <option value="">Which client? (manager will pick if unsure)</option>
                {info.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <textarea className="input min-h-[160px] leading-relaxed" placeholder="What should the client be told? What's done, what's next…" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn btn-dark !h-10 w-full" disabled={busy || !text.trim()} onClick={submit}>
                {busy ? "Sending…" : "Send for approval"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
