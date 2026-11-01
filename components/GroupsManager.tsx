"use client";
import { useEffect, useState } from "react";
import { Users, X } from "lucide-react";
import { api, useLive } from "@/components/Live";
import RecipientPicker, { type RecipientTarget } from "@/components/RecipientPicker";

// WhatsApp groups whose messages come into the inbox. Added automatically when you message a group.
export default function GroupsManager() {
  const { toast } = useLive();
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<RecipientTarget | null>(null);

  useEffect(() => {
    api<{ groups: Record<string, string> }>("/api/groups").then((r) => setGroups(r.groups));
  }, []);

  async function call(action: "track" | "untrack", id: string, name?: string) {
    try {
      const r = await api<{ groups: Record<string, string> }>("/api/groups", { action, id, name });
      setGroups(r.groups);
      toast(action === "track" ? `${name} will now show in the inbox` : "Group removed from the inbox");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  useEffect(() => {
    if (pick?.to.endsWith("@g.us")) {
      call("track", pick.to, pick.toName);
      setPick(null);
      setAdding(false);
    }
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = Object.entries(groups);
  return (
    <div className="card px-5 py-2">
      <div className="flex items-center justify-between py-3">
        <p className="text-[13px] text-[var(--ink-2)]">Client groups whose messages come into your inbox. A group is added automatically the first time you message it.</p>
        <button className="btn btn-sm shrink-0" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "Add group"}
        </button>
      </div>
      {adding && (
        <div className="mb-3 rounded-xl bg-[var(--bg)] p-4">
          <RecipientPicker value={pick} onChange={setPick} />
        </div>
      )}
      <div className="divide-y divide-[var(--line)] pb-2">
        {list.map(([id, name]) => (
          <div key={id} className="flex items-center gap-2.5 py-2">
            <Users size={14} className="text-[var(--muted)]" />
            <span className="flex-1 truncate text-[13.5px]">{name}</span>
            <button className="btn btn-ghost btn-sm !px-2" title="Stop showing this group" onClick={() => call("untrack", id)}>
              <X size={13} />
            </button>
          </div>
        ))}
        {!list.length && !adding && <p className="py-3 text-[13px] text-[var(--muted)]">No groups yet.</p>}
      </div>
    </div>
  );
}
