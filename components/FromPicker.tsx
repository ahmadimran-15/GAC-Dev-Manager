"use client";
import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
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
    <label className="relative inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--line-2)] bg-white pl-2.5 pr-7 text-[12.5px] hover:border-[#a8a8a2]" title="Which of your accounts the reply goes out from">
      <span className="mr-1.5 text-[var(--muted)]">Send from</span>
      <select className="max-w-[320px] cursor-pointer appearance-none truncate bg-transparent font-medium text-[var(--ink)] outline-none" value={value || fallback} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.kind === "email" ? (o.label && o.label !== o.address ? `${o.label} · ${o.address}` : o.address) : /^\d+$/.test(o.address) ? `+${o.address}${o.label && !/^whatsapp$/i.test(o.label) ? ` (${o.label})` : ""}` : o.label}
            {o.id === fallback && options.length > 1 ? " · default" : ""}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-[var(--ink-2)]" />
    </label>
  );
}
