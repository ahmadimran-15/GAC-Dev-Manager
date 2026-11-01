"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function Login() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (res.ok) location.href = params.get("next") || "/";
    else {
      setError((await res.json().catch(() => ({}))).error ?? "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-[360px]">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#171717] text-[16px] font-bold text-white">G</span>
        <h1 className="mt-6 text-[24px] font-semibold tracking-tight">Sign in to GAC Desk</h1>
        <p className="mt-1 text-[14px] text-[var(--ink-2)]">Your client messages, team and tasks.</p>
        <div className="mt-8 space-y-3">
          <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p>}
        <button className="btn btn-dark mt-5 !h-10 w-full" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
