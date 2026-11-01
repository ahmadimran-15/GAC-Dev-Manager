import { NextResponse } from "next/server";
import { EMAIL_PRESETS, addAccount, deleteAccount, getAccount, listAccounts, setAccountStatus, updateAccount } from "@/lib/accounts";
import { testMailbox } from "@/lib/email";
import { listSessions, registerWebhook, sessionStatus } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ accounts: await listAccounts(), presets: EMAIL_PRESETS });
}

const mailCfg = (b: Record<string, string>) => {
  const p = EMAIL_PRESETS[b.provider] ?? EMAIL_PRESETS.custom;
  return {
    imapHost: b.imapHost || p.imapHost,
    imapPort: Number(b.imapPort || p.imapPort),
    smtpHost: b.smtpHost || p.smtpHost,
    smtpPort: Number(b.smtpPort || p.smtpPort),
    username: b.username || b.address,
  };
};

// Add / test / change / remove the company's mailboxes and WhatsApp numbers.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "test-email": {
        if (!b.address || !b.password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
        return NextResponse.json(await testMailbox({ address: b.address.trim(), secret: b.password, config: mailCfg(b) }));
      }
      case "add-email": {
        if (!b.address || !b.password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
        const cfg = mailCfg(b);
        const test = await testMailbox({ address: b.address.trim(), secret: b.password, config: cfg });
        if (!test.imap.startsWith("OK") && !b.force) return NextResponse.json({ error: `Couldn't sign in. Reading: ${test.imap}. Sending: ${test.smtp}`, test }, { status: 400 });
        const id = await addAccount({ kind: "email", label: b.label || b.address.trim(), address: b.address.trim(), provider: b.provider || "custom", config: cfg, secret: b.password, canSend: b.canSend !== false });
        await setAccountStatus(id, test.imap.startsWith("OK"), test.ok ? undefined : `Sending: ${test.smtp}`);
        return NextResponse.json({ ok: true, id, test });
      }
      case "wa-sessions": {
        if (!b.baseUrl || !b.apiKey) return NextResponse.json({ error: "Gateway URL and API key are required" }, { status: 400 });
        return NextResponse.json({ sessions: await listSessions(b.baseUrl, b.apiKey) });
      }
      case "add-whatsapp": {
        if (!b.baseUrl || !b.apiKey || !b.sessionId) return NextResponse.json({ error: "Pick a session first" }, { status: 400 });
        const id = await addAccount({ kind: "whatsapp", label: b.label || b.phone || "WhatsApp", address: b.phone || b.sessionId, provider: "chatslash", config: { baseUrl: b.baseUrl.trim(), sessionId: b.sessionId }, secret: b.apiKey.trim(), canSend: b.canSend !== false });
        const acc = (await getAccount(id))!;
        const st = await sessionStatus(acc);
        await setAccountStatus(id, st.status === "ready", st.status === "ready" ? undefined : `Session ${st.status}`);
        return NextResponse.json({ ok: true, id });
      }
      case "update":
        await updateAccount(b.id, { label: b.label, enabled: b.enabled, canSend: b.canSend });
        return NextResponse.json({ ok: true });
      case "delete":
        await deleteAccount(b.id);
        return NextResponse.json({ ok: true });
      case "register-webhook": {
        const base = String(process.env.PUBLIC_URL || b.publicUrl || "").replace(/\/$/, "");
        if (!base.startsWith("https://")) return NextResponse.json({ error: "Needs a public https address. Set PUBLIC_URL in .env first (tunnel or hosting)." }, { status: 400 });
        const targets = b.id ? [await getAccount(b.id)] : await Promise.all((await listAccounts("whatsapp")).map((a) => getAccount(a.id)));
        for (const a of targets) if (a) await registerWebhook(a, `${base}/api/webhooks/whatsapp`);
        return NextResponse.json({ ok: true, url: `${base}/api/webhooks/whatsapp`, count: targets.length });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
