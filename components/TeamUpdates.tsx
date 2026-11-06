"use client";
import { useEffect, useState } from "react";
import { CheckCheck } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { Avatar, Pill, Section, ago } from "@/components/ui";
import DraftCard from "@/components/DraftCard";
import DailyDigest from "@/components/DailyDigest";
import MessageText from "@/components/MessageText";

interface Handled {
  id: string;
  author: string;
  text: string;
  project: string | null;
  status: string;
  sent_to: string | null;
  created_at: number;
  conv_name: string | null;
}

// Inbox → Team updates: what your team wrote from their portal. Nothing reaches a client until you
// approve it here and pick where it goes. Below: what you already sent or discarded.
export default function TeamUpdates() {
  const { state } = useLive();
  const [done, setDone] = useState<Handled[] | null>(null);
  const pending = state?.drafts ?? [];
  const now = state?.now ?? Date.now();

  // Reload the history whenever the pending list changes (an approve or discard moves one down)
  useEffect(() => {
    api<{ drafts: Handled[] }>("/api/drafts").then((r) => setDone(r.drafts)).catch(() => setDone([]));
  }, [pending.length]);

  return (
    <div className="grid grid-cols-1 gap-8 px-4 pb-10 md:px-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,34%)]">
      <Section title="Waiting for your approval" count={pending.length}>
        <div className="card divide-y divide-[var(--line)] px-4 md:px-5">
          {pending.map((d) => (
            <DraftCard key={d.id} d={d} now={now} />
          ))}
          {!pending.length && (
            <div className="flex flex-col items-center py-14 text-center text-[var(--muted)]">
              <CheckCheck size={24} className="mb-2 text-[var(--green)]" />
              No updates waiting. Your team writes them from their portal.
            </div>
          )}
        </div>
      </Section>

      <div className="lg:col-span-1">
        <DailyDigest />
      </div>

      <Section title="Already handled">
        <div className="card divide-y divide-[var(--line)] px-4">
          {(done ?? []).map((d) => (
            <div key={d.id} className="py-3">
              <div className="mb-1 flex items-center gap-2 text-[12.5px]">
                <Avatar name={d.author} size={20} />
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-semibold">{d.author}</b>
                  <span className="text-[var(--muted)]"> · {ago(d.created_at, now)}</span>
                </span>
                {d.status === "approved" ? <Pill tone="green">Sent{d.sent_to ? ` to ${d.sent_to}` : ""}</Pill> : <Pill>Discarded</Pill>}
              </div>
              <div className="line-clamp-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
                <MessageText text={d.text} />
              </div>
              {d.project && <div className="mt-1 text-[11.5px] text-[var(--muted)]">{d.project}</div>}
            </div>
          ))}
          {done && !done.length && <div className="py-6 text-center text-[13px] text-[var(--muted)]">Nothing yet.</div>}
          {!done && <div className="py-6 text-center text-[13px] text-[var(--muted)]">Loading…</div>}
        </div>
      </Section>
    </div>
  );
}
