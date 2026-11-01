"use client";
import { useEffect } from "react";
import { useLive, accountOf } from "@/components/Live";

// Choose which mailbox / WhatsApp number a reply goes out from. Defaults to the one the client wrote to.
export default function FromPicker({ channel, account, value, onChange }: { channel: string; account: string | null | undefined; value: string; onChange: (id: string) => void }) {
  const { state } = useLive();
  const options = (state?.accounts ?? []).filter((a) => a.kind === channel && a.enabled && a.canSend);
  const fallback = accountOf(options, account)?.id ?? options[0]?.id ?? "";

  useEffect(() => {
    if (!value || !options.some((o) => o.id === value)) onChange(fallback);
  }, [fallback, options.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (channel !== "email" && channel !== "whatsapp") return null;
  if (!options.length) return <span className="text-[12px] text-[var(--amber)]">No {channel === "email" ? "mailbox" : "WhatsApp number"} set up for sending. Add one in Settings.</span>;

  return (
    <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
      From
      <select className="max-w-[260px] rounded-md bg-transparent px-1 py-0.5 font-medium text-[var(--ink)] outline-none hover:bg-[var(--hover)]" value={value || fallback} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.kind === "email" ? (o.label && o.label !== o.address ? `${o.label} · ${o.address}` : o.address) : `${o.label}${o.address && o.address !== o.label && /^\d+$/.test(o.address) ? ` · +${o.address}` : ""}`}
            {o.id === fallback ? " (client wrote here)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
