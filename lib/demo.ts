import { get, kvGet, run, uid } from "@/lib/db";

// Test data so the dashboard has something to show before channels are connected.
// Removed from Settings → "Clear test data"; real messages are never touched.

const MIN = 60_000;

type DemoMsg = [dir: "in" | "out", text: string, minsAgo: number, extra?: { ack?: boolean; voice?: boolean }];

const CONVS: {
  channel: string;
  ext: string;
  account?: string;
  name: string;
  company: string;
  project: string;
  suggestion?: string;
  msgs: DemoMsg[];
}[] = [
  {
    channel: "whatsapp", ext: "447700900123", name: "Mark", company: "MJP Logistics", project: "MJP Dashboard",
    suggestion: "Hi Mark, sorry for the wait. The team is fixing the CSV export and the date filter today, and we'll add your logo to the PDF report. I'll update you by 6 PM.",
    msgs: [
      ["in", "The new dashboard looks great, thanks!", 2900],
      ["out", "Glad you like it, Mark. Let us know if anything comes up.", 2880],
      ["in", "Hi, the export to CSV button on the dashboard is not working since this morning. Can you check?", 95],
      ["in", "Also the date filter resets when I refresh the page.", 90],
      ["in", "Please also add our logo to the PDF report, the one from our website.", 88, { voice: true }],
      ["in", "Any update on this?", 12],
    ],
  },
  {
    channel: "slack", ext: "U04SARAHK", name: "Sarah Khan", company: "Custom Door Co.", project: "Custom Door",
    suggestion: "Hi Sarah, Friday works for the quote module once you approve the final design by Wednesday. We're looking into the Stripe test payments on staging now and will confirm today.",
    msgs: [
      ["in", "Can we move the delivery of the quote module to Friday?", 40],
      ["out", "Hi Sarah, received. Checking with the team and will confirm shortly.", 38, { ack: true }],
      ["in", "Also, Stripe test payments are failing on staging.", 35],
    ],
  },
  {
    channel: "whatsapp", ext: "923001112233", name: "Omar Farooq", company: "MI Optica", project: "MI Optica",
    suggestion: "Hi Omar, thanks for flagging this. We're checking the frame stock sync right now and will update you within the hour.",
    msgs: [["in", "Frame stock is not updating on the website. Customers are ordering frames that are out of stock.", 55]],
  },
  {
    channel: "teams", ext: "kevin@outreachlabs.io", name: "Kevin Walsh", company: "Outreach Labs", project: "Lemlist → n8n",
    suggestion: "Hi Kevin, 3 PM tomorrow works. I'll send you a calendar invite shortly.",
    msgs: [["in", "Can we have a quick call tomorrow at 3 PM to review the workflow?", 70]],
  },
  {
    channel: "outlook", ext: "david.lee@mjplogistics.com", name: "David Lee", company: "MJP Logistics", project: "MJP Dashboard",
    suggestion: "Hi David, no problem. Please send her email and we'll set up staging access before Monday.",
    msgs: [["in", "We need access to the staging environment for a new hire starting Monday. Her email is on the way.", 15]],
  },
  {
    channel: "whatsapp", ext: "971501234567", name: "Zoe", company: "Jarvis AI", project: "Jarvis App",
    suggestion: "Hi Zoe, thanks for the voice note. We're looking into the Urdu transcription issue and will update you tomorrow.",
    msgs: [["in", "The voice notes are not being transcribed correctly in Urdu, can you check?", 25, { voice: true }]],
  },
  {
    channel: "email", ext: "lisa@outreachlabs.io", account: "Zoho", name: "Lisa Brown", company: "Outreach Labs", project: "Lemlist → n8n",
    msgs: [
      ["in", "Replies from Lemlist are not showing in our CRM since yesterday.", 130],
      ["out", "Hi Lisa, we've received this and Hamza is on it. We'll update you today.", 125, { ack: true }],
    ],
  },
  {
    channel: "email", ext: "john@customdoor.co", account: "Gmail", name: "John Miller", company: "Custom Door Co.", project: "Custom Door",
    msgs: [
      ["in", "Invoice 1042: could you resend it with the updated VAT number?", 210],
      ["out", "Sure John, we're updating it now. You'll have it before end of day.", 200],
    ],
  },
  {
    channel: "teams", ext: "priya@jarvis.ai", name: "Priya", company: "Jarvis AI", project: "Jarvis App",
    msgs: [
      ["in", "The demo went well, thanks to the team!", 300],
      ["out", "Thank you Priya! We'll share the next milestone plan tomorrow.", 290],
    ],
  },
  {
    channel: "email", ext: "ahmed@mioptica.com", account: "Titan", name: "Ahmed Siddiqui", company: "MI Optica", project: "MI Optica",
    msgs: [
      ["in", "Can you share the Loom video of the new checkout?", 320],
      ["out", "Here you go: loom.com/share/checkout-walkthrough", 310],
    ],
  },
];

const DRAFTS: [conv: string, author: string, text: string, minsAgo: number][] = [
  ["Mark", "TuLab", "hello mark, we fixed the csv issue and its deployed now. please check and tell if any problem", 6],
  ["Zoe", "Ayesha Noor", "we are looking in to the urdu voice notes problem, will update you by tomorow", 9],
  ["Lisa Brown", "Hamza Khan", "hi lisa the reply sync is fixed, the replies from yesterday are also synced now in crm", 22],
];

export async function seedDemo() {
  if ((await kvGet("demo_seeded")) || (await get("select 1 from conversations limit 1"))) return;
  await run("insert into kv (k, v) values ('demo_seeded', '1') on conflict (k) do nothing");
  const now = Date.now();
  const ids: Record<string, string> = {};
  for (const c of CONVS) {
    const id = uid("c_");
    ids[c.name] = id;
    const lastIn = [...c.msgs].reverse().find((m) => m[0] === "in");
    await run(
      "insert into conversations (id, channel, external_id, account, name, company, project, suggestion, suggestion_for, demo, created_at) values (?,?,?,?,?,?,?,?,?,1,?)",
      id, c.channel, c.ext, c.account ?? "", c.name, c.company, c.project, c.suggestion ?? null, c.suggestion && lastIn ? "latest" : null, now - 3000 * MIN,
    );
    for (const [dir, text, ago, extra] of c.msgs) {
      await run(
        "insert into messages (id, conv_id, direction, kind, text, transcript, ack, sent_by, status, created_at) values (?,?,?,?,?,?,?,?,?,?)",
        uid("m_"), id, dir, extra?.voice ? "voice" : "text", extra?.voice ? null : text, extra?.voice ? text : null, extra?.ack ? 1 : 0, dir === "out" ? "me" : null, "demo", now - ago * MIN,
      );
    }
  }
  for (const [conv, author, text, ago] of DRAFTS) {
    await run("insert into drafts (id, conv_id, author, text, created_at) values (?,?,?,?,?)", uid("d_"), ids[conv], author, text, now - ago * MIN);
  }
}

export async function clearDemo() {
  await run("delete from messages where conv_id in (select id from conversations where demo = 1)");
  await run("delete from drafts where conv_id in (select id from conversations where demo = 1)");
  await run("delete from conversations where demo = 1");
}

// ---------- Team & tasks shown until ClickUp is connected ----------

export interface Task {
  id: string;
  title: string;
  project: string;
  assignee: string;
  status: string;
  due: string | null;
  spentMin: number;
  estimateMin: number | null;
  url?: string;
  dueAt?: number | null; // ms, for on-time stats
  doneAt?: number | null;
}

export const DEMO_PROJECTS = ["Custom Door", "MJP Dashboard", "Jarvis App", "Lemlist → n8n", "MI Optica"];
export const DEMO_TEAM = ["TuLab", "Ali Raza", "Sara Malik", "Hamza Khan", "Ayesha Noor"];

const T = (id: string, title: string, project: string, assignee: string, status: string, due: string | null, spentMin: number, estimateMin: number): Task => ({ id, title, project, assignee, status, due, spentMin, estimateMin });

export const DEMO_TASKS: Task[] = [
  T("t1", "Fix CSV export button", "MJP Dashboard", "TuLab", "in progress", "Nov 2", 130, 180),
  T("t2", "Invoice export with VAT", "Custom Door", "TuLab", "blocked", "Nov 3", 110, 150),
  T("t3", "Webhook retry queue", "Lemlist → n8n", "TuLab", "review", "Nov 2", 260, 240),
  T("t4", "Stripe test checkout", "Custom Door", "TuLab", "to do", "Nov 5", 0, 120),
  T("t5", "Date filter persists on refresh", "MJP Dashboard", "Ali Raza", "in revision", "Nov 2", 295, 210),
  T("t6", "Urdu voice transcription", "Jarvis App", "Ali Raza", "review", "Nov 3", 330, 300),
  T("t7", "Lead dedupe workflow", "Lemlist → n8n", "Ali Raza", "to do", "Nov 6", 0, 240),
  T("t8", "Staging access setup", "MJP Dashboard", "Sara Malik", "in progress", "Nov 2", 40, 60),
  T("t9", "Checkout UI polish", "MI Optica", "Sara Malik", "review", "Nov 3", 200, 180),
  T("t10", "Quote module delivery", "Custom Door", "Sara Malik", "to do", "Nov 6", 0, 300),
  T("t11", "Lemlist reply sync", "Lemlist → n8n", "Hamza Khan", "in progress", "Nov 2", 185, 240),
  T("t12", "Frame stock sync", "MI Optica", "Hamza Khan", "blocked", "Nov 3", 60, 180),
  T("t13", "Zapier → n8n migration", "Lemlist → n8n", "Hamza Khan", "to do", "Nov 8", 0, 360),
  T("t14", "Jarvis memory module", "Jarvis App", "Ayesha Noor", "in progress", "Nov 4", 280, 420),
  T("t15", "RAG document ingestion", "Jarvis App", "Ayesha Noor", "review", "Nov 2", 405, 300),
  T("t16", "Voice intent classifier", "Jarvis App", "Ayesha Noor", "to do", "Nov 7", 0, 240),
  T("t17", "Add logo to PDF report", "MJP Dashboard", "Sara Malik", "complete", "Oct 30", 75, 90),
  T("t18", "Gemini fallback router", "Jarvis App", "Ayesha Noor", "complete", "Oct 28", 180, 210),
  T("t19", "Bounce handler", "Lemlist → n8n", "Hamza Khan", "complete", "Oct 29", 140, 120),
  T("t20", "Quote PDF template", "Custom Door", "TuLab", "complete", "Oct 29", 210, 240),
];
