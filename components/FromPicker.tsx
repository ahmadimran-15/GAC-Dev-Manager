"use client";
import { useEffect } from "react";
import { useLive, accountOf } from "@/components/Live";
import Dropdown from "@/components/Dropdown";

// Choose which mailbox / WhatsApp number a reply goes out from. Defaults to the one the client wrote to.
export default function FromPicker({ channel, account, value, onChange }: { channel: string; account: string | null | undefined; value: string; onChange: (id: string) => void }) {
  const { state } = useLive();
  const options = (state?.accounts ?? []).filter((a) => a.kind === channel && a.enabled && a.canSend);
  const fallback = accountOf(options, account)?.id ?? options[0]?.id ?? "";

  // Follow the conversation. Without `account` here the previous chat's number stayed selected —
  // it was still a valid option, so nothing reset it — and the reply went out from the wrong number.
  useEffect(() => {
    if (fallback && fallback !== value) onChange(fallback);
  }, [fallback, account]); // eslint-disable-line react-hooks/exhaustive-deps

  if (channel !== "email" && channel !== "whatsapp") return null;
  if (!options.length) return <span className="text-[12px] text-[var(--amber)]">No {channel === "email" ? "mailbox" : "WhatsApp number"} set up for sending. Add one in Settings.</span>;

  return (
    <Dropdown
      label="Send from"
      up
      title="Which of your accounts the reply goes out from"
      value={value || fallback}
      onChange={onChange}
      options={options.map((o) => ({
        value: o.id,
        label: o.kind === "email" ? o.address : /^\d+$/.test(o.address) ? `+${o.address}` : o.label,
        hint: [o.kind === "email" && o.label && o.label !== o.address ? o.label : o.kind === "whatsapp" && !/^whatsapp$/i.test(o.label) ? o.label : "", o.id === fallback && options.length > 1 ? "default" : ""].filter(Boolean).join(" · ") || undefined,
      }))}
    />
  );
}
