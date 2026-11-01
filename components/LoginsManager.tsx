"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api, useLive } from "@/components/Live";
import { Avatar, Pill, ago } from "@/components/ui";

interface U {
  id: string;
  email: string;
  name: string;
  role: "admin" | "team";
  active: boolean;
  lastLogin: number | null;
}

// Owner and team logins. Team members only get the update portal: no inbox, no contacts, no channels.
export default function LoginsManager() {
  const { toast } = useLive();
  const [users, setUsers] = useState<U[]>([]);
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "team" });
  const [myPw, setMyPw] = useState("");

  const load = () => api<{ users: U[]; me: { id: string } }>("/api/users").then((r) => (setUsers(r.users), setMe(r.me)));
  useEffect(() => {
    load();
  }, []);

  async function call(body: Record<string, unknown>, msg: string) {
    try {
      await api("/api/users", body);
      toast(msg);
      load();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
      return false;
    }
  }

  return (
    <div className="card px-5 py-2">
      <div className="flex items-center justify-between py-3">
        <p className="text-[13px] text-[var(--ink-2)]">Teammates sign in at the same address and only see “Send a client update”. You approve and send.</p>
        <button className="btn btn-sm shrink-0" onClick={() => setAdding((a) => !a)}>
          {adding ? <X size={13} /> : <Plus size={13} />} {adding ? "Cancel" : "Add login"}
        </button>
      </div>
      {adding && (
        <div className="fade-in mb-3 grid grid-cols-2 gap-2 rounded-xl bg-[var(--bg)] p-4">
          <input className="input" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" type="email" placeholder="Email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="input" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="team">Team member (update portal only)</option>
            <option value="admin">Owner (full access)</option>
          </select>
          <div className="col-span-2 flex justify-end">
            <button
              className="btn btn-dark btn-sm"
              disabled={!f.name || !f.email || f.password.length < 8}
              onClick={async () => {
                if (await call({ action: "create", ...f }, `${f.name} can now sign in`)) {
                  setF({ name: "", email: "", password: "", role: "team" });
                  setAdding(false);
                }
              }}
            >
              Create login
            </button>
          </div>
        </div>
      )}
      <div className="divide-y divide-[var(--line)]">
        {users.map((u) => (
          <div key={u.id} className={`flex items-center gap-3 py-2.5 ${u.active ? "" : "opacity-50"}`}>
            <Avatar name={u.name} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px]">
                <span className="font-medium">{u.name}</span> <span className="text-[var(--muted)]">· {u.email}</span>
              </div>
              <div className="text-[12px] text-[var(--muted)]">{u.lastLogin ? `Last sign-in ${ago(u.lastLogin)}` : "Never signed in"}</div>
            </div>
            <Pill tone={u.role === "admin" ? "dark" : "gray"}>{u.role === "admin" ? "Owner" : "Team"}</Pill>
            {u.id !== me?.id && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const pw = prompt(`New password for ${u.name} (8+ characters):`);
                    if (pw) call({ action: "update", id: u.id, password: pw }, "Password reset");
                  }}
                >
                  Reset password
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => call({ action: "update", id: u.id, active: !u.active }, u.active ? "Access paused" : "Access restored")}>
                  {u.active ? "Pause" : "Restore"}
                </button>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => confirm(`Remove ${u.name}'s login?`) && call({ action: "delete", id: u.id }, "Login removed")}>
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-[var(--line)] py-3">
        <span className="shrink-0 text-[13px] text-[var(--ink-2)]">Change my password</span>
        <input className="input !py-1.5" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={myPw} onChange={(e) => setMyPw(e.target.value)} />
        <button className="btn btn-sm shrink-0" disabled={myPw.length < 8} onClick={async () => (await call({ action: "my-password", password: myPw }, "Your password was changed")) && setMyPw("")}>
          Save
        </button>
      </div>
    </div>
  );
}
