"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCheck } from "lucide-react";
import type { Board } from "@/lib/clickup";
import { api, useLive } from "@/components/Live";
import { Avatar, Channel, Section, ago, duration, mins } from "@/components/ui";
import WaitingCard from "@/components/WaitingCard";
import DraftCard from "@/components/DraftCard";
import { OverviewSkeleton } from "@/components/Skeleton";
import { clock, useTick, type RunningTimer } from "@/components/TaskControls";

type TeamBoard = Board & {
  now: number;
  running: RunningTimer[];
  changes: { task_id: string; task_title: string | null; person: string | null; from_status: string | null; to_status: string; source: string; at: number }[];
};

function Stat({ label, value, hint, alert }: { label: string; value: React.ReactNode; hint?: string; alert?: boolean }) {
  return (
    <div className="min-w-0 border-[var(--line)] px-4 py-4 max-md:even:border-l max-md:[&:nth-child(n+3)]:border-t md:px-6 md:py-5 md:first:pl-0">
      <div className="eyebrow">{label}</div>
      <div className={`tnum mt-1 text-[24px] md:text-[28px] font-semibold leading-tight tracking-tight ${alert ? "text-[var(--red)]" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[12.5px] text-[var(--muted)]">{hint}</div>}
    </div>
  );
}

export default function Overview() {
  const { state } = useLive();
  const [board, setBoard] = useState<TeamBoard | null>(null);
  const [date, setDate] = useState("");
  const tick = useTick(board?.now);

  useEffect(() => {
    const load = () => api<TeamBoard>("/api/team").then(setBoard).catch(() => {});
    load();
    setDate(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }));
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!state) return <OverviewSkeleton />;

  const now = state.now;
  const waiting = state.conversations.filter((c) => c.waiting);
  const answered = state.conversations.filter((c) => !c.waiting).slice(0, 6);
  const open = board?.tasks.filter((t) => !/complete|done|closed/.test(t.status)) ?? [];
  const active = open.filter((t) => /progress|revision/.test(t.status));
  const blocked = open.filter((t) => /block/.test(t.status));
  const oldest = waiting[0];

  return (
    <div className="fade-in mx-auto w-full px-4 pb-20 pt-6 md:px-6 md:pt-10 xl:px-10">
      <div className="eyebrow">{date || " "}</div>
      <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight md:text-[30px]">
        {waiting.length ? `${waiting.length} client${waiting.length > 1 ? "s are" : " is"} waiting for you.` : "You're all caught up."}
      </h1>
      <p className="mt-1 text-[14px] text-[var(--ink-2)] md:text-[15px]">
        {oldest?.waitingSince
          ? `${oldest.name} has waited longest (${duration(mins(oldest.waitingSince, now))}). Replies are already drafted below.`
          : "No client is waiting for a reply right now."}
      </p>

      <div className="mt-6 grid grid-cols-2 border-y border-[var(--line)] md:mt-8 md:grid-cols-4 md:divide-x md:divide-[var(--line)]">
        <Stat label="Waiting for a reply" value={waiting.length} alert={waiting.some((c) => c.waitingSince && mins(c.waitingSince, now) >= 30)} hint={waiting.length ? `${waiting.filter((c) => c.waitingSince && mins(c.waitingSince, now) >= 30).length} over 30 minutes` : "Nobody"} />
        <Stat label="First reply today" value={state.stats.firstReplyAvg !== null ? `${state.stats.firstReplyAvg}m` : "—"} hint={`${state.stats.repliesToday} conversation${state.stats.repliesToday === 1 ? "" : "s"} answered`} />
        <Stat label="Tasks in progress" value={board ? active.length : "—"} hint={board ? `${blocked.length} blocked · ${open.length} open` : ""} />
        <Stat label="Team drafts" value={state.drafts.length} hint="waiting for your approval" />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(340px,28%)]">
        <Section title="Waiting for you" count={waiting.length} right={<Link href="/inbox" className="text-[13px] text-[var(--ink-2)] hover:text-[var(--ink)]">Open inbox →</Link>}>
          <div className="grid grid-cols-1 items-start gap-3 min-[1800px]:grid-cols-2">
            {waiting.map((c) => (
              <WaitingCard key={c.id} c={c} now={now} />
            ))}
            {!waiting.length && (
              <div className="card flex flex-col items-center py-14 text-center text-[var(--muted)] min-[1800px]:col-span-2">
                <CheckCheck size={26} className="mb-2 text-[var(--green)]" />
                Every client has an answer.
              </div>
            )}
          </div>
        </Section>

        <aside className="space-y-10">
          <Section title="From your team" count={state.drafts.length} right={<Link href="/inbox?tab=team" className="text-[13px] text-[var(--ink-2)] hover:text-[var(--ink)]">Team updates →</Link>}>
            <div className="card divide-y divide-[var(--line)] px-4">
              {state.drafts.map((d) => (
                <DraftCard key={d.id} d={d} now={now} />
              ))}
              {!state.drafts.length && <div className="py-6 text-center text-[13px] text-[var(--muted)]">No drafts waiting.</div>}
            </div>
          </Section>

          <Section title="Working now" right={<Link href="/team" className="text-[13px] text-[var(--ink-2)] hover:text-[var(--ink)]">Team →</Link>}>
            <div className="space-y-3">
              {(board?.team ?? []).map((name) => {
                const mine = active.filter((t) => t.assignee === name);
                const isBlocked = blocked.some((t) => t.assignee === name);
                const timer = board?.running.find((r) => r.person === name);
                return (
                  <div key={name} className="flex items-start gap-3">
                    <Avatar name={name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13.5px] font-medium">
                        {name}
                        <span className="dot" style={{ background: timer || mine.length ? "var(--green)" : isBlocked ? "var(--red)" : "#cfcfca" }} />
                        {timer && <span className="tnum ml-auto text-[12px] font-normal text-[var(--green)]">{clock(timer.started_at, tick)}</span>}
                      </div>
                      <div className="truncate text-[12.5px] text-[var(--muted)]">
                        {timer ? `${timer.task_title} · ${timer.project ?? ""}` : mine[0] ? `${mine[0].title} · ${mine[0].project}` : isBlocked ? "Blocked" : "Nothing in progress"}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!board &&
                [0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skel h-7 w-7 !rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skel h-[11px] w-1/2" />
                      <div className="skel h-[10px] w-4/5" />
                    </div>
                  </div>
                ))}
            </div>
          </Section>

          {!!board?.changes?.length && (
            <Section title="Status changes" right={<Link href="/team" className="text-[13px] text-[var(--ink-2)] hover:text-[var(--ink)]">All →</Link>}>
              <div className="space-y-2">
                {board.changes.slice(0, 5).map((c, i) => (
                  <div key={i} className="text-[12.5px] leading-snug">
                    <div className="truncate font-medium">{c.task_title ?? board.tasks.find((t) => t.id === c.task_id)?.title ?? c.task_id}</div>
                    <div className="text-[var(--muted)]">
                      {c.from_status ?? "?"} → <span className="text-[var(--ink-2)]">{c.to_status}</span> · {c.person ?? "someone"} · {ago(c.at, now)}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Recently answered">
            <div className="space-y-1">
              {answered.map((c) => (
                <Link key={c.id} href={`/inbox?c=${c.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white">
                  <Avatar name={c.name} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">
                      {c.name} <span className="text-[var(--muted)]">· {c.last ? ago(c.last.at, now) : ""}</span>
                    </div>
                  </div>
                  <Channel c={c.channel} withLabel={false} />
                  <ArrowRight size={13} className="text-[var(--muted)]" />
                </Link>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
