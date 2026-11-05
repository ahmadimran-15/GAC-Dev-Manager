"use client";
import { useEffect, useState } from "react";
import { api, useLive } from "@/components/Live";

// Which connected WhatsApp numbers the team portal may show. With two numbers connected, one can be
// kept entirely out of the team's view. Nothing ticked means every number, which is the old behaviour.

interface Acc {
  id: string;
  label: string;
  address: string | null;
  enabled: boolean;
}

export default function TeamWhatsAppAccess() {
  const { toast } = useLive();
  const [accounts, setAccounts] = useState<Acc[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => api<{ accounts: Acc[]; allowed: string[] }>("/api/team-access").then((r) => (setAccounts(r.accounts ?? []), setAllowed(r.allowed ?? [])));
  useEffect(() => {
    load();
  }, []);

  const save = async (next: string[]) => {
    setBusy(true);
    const before = allowed;
    setAllowed(next);
    try {
      await api("/api/team-access", { allowed: next });
      toast(next.length ? "Saved" : "The team can see every number again");
    } catch (e) {
      setAllowed(before);
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => save(allowed.includes(id) ? allowed.filter((x) => x !== id) : [...allowed, id]);

  return (
    <div className="card px-5 py-2">
      <p className="py-3 text-[13px] text-[var(--ink-2)]">
        Tick the numbers the team may see in their WhatsApp portal. Nothing ticked means all of them. Client names and phone numbers stay hidden either way.
      </p>
      {!accounts.length && <p className="pb-3 text-[13px] text-[var(--muted)]">No WhatsApp number is connected yet.</p>}
      <div className="divide-y divide-[var(--line)]">
        {accounts.map((a) => {
          const on = allowed.includes(a.id);
          return (
            <label key={a.id} className={`flex cursor-pointer items-center gap-3 py-2.5 ${a.enabled ? "" : "opacity-50"}`}>
              <input type="checkbox" className="h-4 w-4 accent-[var(--ink)]" checked={on} disabled={busy} onChange={() => toggle(a.id)} />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">
                {a.label}
                {a.address && <span className="text-[var(--muted)]"> · {a.address}</span>}
              </span>
              <span className="shrink-0 text-[12px] text-[var(--muted)]">{allowed.length ? (on ? "Team can see this" : "Hidden from the team") : "Team can see this"}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
