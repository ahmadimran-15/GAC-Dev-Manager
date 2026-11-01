"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Mic } from "lucide-react";
import { useLive } from "@/components/Live";
import Reminders from "@/components/Reminders";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/inbox", label: "Inbox" },
  { href: "/team", label: "Team" },
  { href: "/settings", label: "Settings" },
];

export default function TopNav() {
  const path = usePathname();
  const { state, openAssistant } = useLive();
  const [menu, setMenu] = useState(false);
  const waiting = state?.stats.waiting ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#171717] text-[13px] font-bold text-white">G</span>
          <span className="font-semibold tracking-tight">GAC Desk</span>
        </Link>
        <nav className="flex items-center gap-0.5">
          {LINKS.map((l) => {
            const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`relative rounded-lg px-3 py-1.5 text-[13.5px] transition ${on ? "bg-white font-medium text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]"}`}>
                {l.label}
                {l.href === "/inbox" && waiting > 0 && <span className="tnum ml-1.5 rounded-full bg-[var(--red)] px-1.5 text-[10.5px] font-semibold text-white">{waiting}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          {!!state?.health?.problems.length && (
            <Link
              href="/settings#health"
              title={state.health.problems.join("\n")}
              className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-[#fdecec] px-2.5 py-1 text-[12px] font-medium text-[#c7353a] hover:bg-[#fbdcdc]"
            >
              <span className="dot" style={{ background: "var(--red)" }} />
              {state.health.problems.length} issue{state.health.problems.length > 1 ? "s" : ""}
            </Link>
          )}
          <button onClick={openAssistant} className="flex h-9 w-[260px] items-center gap-2 rounded-xl border border-[var(--line-2)] bg-white px-3 text-[13px] text-[var(--muted)] transition hover:border-[#c9c9c3]">
            <Mic size={15} className="text-[var(--ink)]" />
            Ask or tell me what to do
            <kbd className="ml-auto rounded border border-[var(--line-2)] px-1.5 text-[11px]">/</kbd>
          </button>
          <Reminders />
          <div className="relative">
            <button className="grid h-9 w-9 place-items-center rounded-full bg-[#171717] text-[12px] font-semibold text-white" onClick={() => setMenu((m) => !m)}>
              {(state?.me?.name ?? "Me").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
            </button>
            {menu && (
              <div className="pop-in absolute right-0 top-11 w-44 rounded-xl border border-[var(--line)] bg-white p-1 shadow-lg">
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)]"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    location.href = "/login";
                  }}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
