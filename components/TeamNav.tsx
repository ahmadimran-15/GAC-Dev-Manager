"use client";
import { useState } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import Confirm from "@/components/Confirm";

// The one bar across the team side, so the update form and the WhatsApp chats read as two parts of
// the same system rather than two unrelated pages. Each button only appears if that login may open
// it, which is set per person in Users → Logins.

export interface TeamCan {
  form: boolean;
  portal: boolean;
}

export type TeamTab = "form" | "chats" | "work";

// Asked first: it sits next to the buttons people use all day, and signing out by accident means
// finding the password again.
export const signOut = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.href = "/login";
};

export default function TeamNav({ name, can, active, onTab }: { name?: string; can: TeamCan; active: TeamTab; onTab?: (t: "chats" | "work") => void }) {
  const [askOut, setAskOut] = useState(false);
  const items: { key: TeamTab; label: string; href: string; show: boolean }[] = [
    { key: "form", label: "Send update", href: "/form", show: can.form },
    { key: "chats", label: "WhatsApp", href: "/portal", show: can.portal },
    { key: "work", label: "My tasks", href: "/portal?tab=work", show: can.portal },
  ];
  const style = (on: boolean) =>
    `whitespace-nowrap rounded-lg px-3 py-1.5 text-[13.5px] transition ${on ? "bg-white font-medium text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]"}`;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link href={can.form ? "/form" : "/portal"} className="flex shrink-0 items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#171717] text-[13px] font-bold text-white">G</span>
        <span className="font-semibold tracking-tight">GAC Desk</span>
      </Link>

      <nav className="flex items-center gap-1">
        {items
          .filter((i) => i.show)
          .map((i) =>
            // On the portal itself the two tabs switch in place; from the form they are links.
            onTab && i.key !== "form" ? (
              <button key={i.key} className={style(active === i.key)} onClick={() => onTab(i.key as "chats" | "work")}>
                {i.label}
              </button>
            ) : (
              <Link key={i.key} href={i.href} className={style(active === i.key)}>
                {i.label}
              </Link>
            ),
          )}
      </nav>

      <span className="ml-auto flex shrink-0 items-center gap-3 text-[13px] text-[var(--muted)]">
        {name}
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1 transition hover:border-[#f0cfcf] hover:bg-[#fdecec] hover:text-[var(--red)]"
          onClick={() => setAskOut(true)}
        >
          <LogOut size={14} /> Sign out
        </button>
      </span>

      <Confirm
        open={askOut}
        Icon={LogOut}
        title="Sign out of GAC Desk?"
        message="You'll need your email and password to get back in."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onCancel={() => setAskOut(false)}
        onConfirm={signOut}
      />
    </div>
  );
}
