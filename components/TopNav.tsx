"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutGrid, LogOut, Mic, Settings, Users } from "lucide-react";
import { useLive } from "@/components/Live";
import Reminders from "@/components/Reminders";

const LINKS = [
  { href: "/", label: "Overview", Icon: LayoutGrid },
  { href: "/inbox", label: "Inbox", Icon: Inbox },
  { href: "/team", label: "Team", Icon: Users },
  { href: "/settings", label: "Settings", Icon: Settings },
];

// Laptop: one top bar. Phone: compact top bar + a tab bar at the bottom (thumb reach).
export default function TopNav() {
  const path = usePathname();
  const { state, openAssistant } = useLive();
  const [menu, setMenu] = useState(false);
  const waiting = state?.stats.waiting ?? 0;
  const problems = state?.health?.problems.length ?? 0;
  const isOn = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur-md">
        <div className="flex h-14 w-full items-center gap-3 px-4 md:gap-6 md:px-6 xl:px-10">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#171717] text-[13px] font-bold text-white">G</span>
            <span className="hidden font-semibold tracking-tight sm:inline">GAC Desk</span>
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`relative whitespace-nowrap rounded-lg px-3 py-1.5 text-[13.5px] transition ${isOn(l.href) ? "bg-white font-medium text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]"}`}
              >
                {l.label}
                {l.href === "/inbox" && waiting > 0 && <span className="tnum ml-1.5 rounded-full bg-[var(--red)] px-1.5 text-[10.5px] font-semibold text-white">{waiting}</span>}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            {problems > 0 && (
              <Link
                href="/settings#health"
                title={state!.health!.problems.join("\n")}
                className="mr-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#fdecec] px-2.5 py-1 text-[12px] font-medium text-[#c7353a] hover:bg-[#fbdcdc]"
              >
                <span className="dot" style={{ background: "var(--red)" }} />
                {problems}
                <span className="hidden sm:inline"> issue{problems > 1 ? "s" : ""}</span>
              </Link>
            )}
            <button
              onClick={openAssistant}
              title="Ask or tell me what to do  ( / )"
              className="flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--line-2)] bg-white text-[13px] text-[var(--muted)] transition hover:border-[#c9c9c3] lg:w-[260px] lg:justify-start lg:px-3"
            >
              <Mic size={15} className="shrink-0 text-[var(--ink)]" />
              <span className="hidden truncate lg:inline">Ask or tell me what to do</span>
              <kbd className="ml-auto hidden rounded border border-[var(--line-2)] px-1.5 text-[11px] lg:inline">/</kbd>
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

      {/* Phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[var(--line)] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {LINKS.map(({ href, label, Icon }) => {
          const on = isOn(href);
          return (
            <Link key={href} href={href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]"}`}>
              <Icon size={20} strokeWidth={on ? 2.2 : 1.8} />
              {label}
              {href === "/inbox" && waiting > 0 && (
                <span className="tnum absolute left-1/2 top-1 ml-2 min-w-[16px] rounded-full bg-[var(--red)] px-1 text-center text-[10px] font-semibold leading-4 text-white">{waiting}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
