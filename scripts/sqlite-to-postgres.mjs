// One-off: copy data/local.db (SQLite) into the Supabase Postgres database from .env.
// Run from the project folder:  node scripts/sqlite-to-postgres.mjs
// Safe to re-run: existing rows are kept (on conflict do nothing).
import fs from "fs";
import path from "path";
import postgres from "postgres";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const file = path.join(process.cwd(), "data", "local.db");
if (!fs.existsSync(file)) {
  console.log("No data/local.db to copy.");
  process.exit(0);
}

const { DatabaseSync } = await import("node:sqlite");
const lite = new DatabaseSync(file);
const sql = postgres({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME ?? "postgres",
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: "require",
  prepare: false,
  max: 2,
});

// Same tables the app creates (lib/db.ts), so the copy can run before the app first starts.
await sql.unsafe(`
create table if not exists conversations (id text primary key, channel text not null, external_id text not null, account text not null default '', name text not null, company text, project text, subject text, status text not null default 'open', suggestion text, suggestion_for text, reminded_at bigint, demo integer not null default 0, created_at bigint not null, unique (channel, external_id, account));
create table if not exists messages (id text primary key, conv_id text not null, direction text not null, kind text not null default 'text', text text, transcript text, media_path text, media_mime text, external_id text, ack integer not null default 0, sent_by text, status text, via text, created_at bigint not null);
create index if not exists messages_conv on messages (conv_id, created_at);
create unique index if not exists messages_ext on messages (conv_id, external_id) where external_id is not null;
create table if not exists drafts (id text primary key, conv_id text, project text, author text not null, text text not null, status text not null default 'pending', created_at bigint not null);
create table if not exists events (id bigint generated always as identity primary key, source text not null, payload text not null, created_at bigint not null);
create table if not exists kv (k text primary key, v text);
create table if not exists accounts (id text primary key, kind text not null, label text not null, address text not null, provider text not null, config text not null default '{}', secret text not null, enabled integer not null default 1, can_send integer not null default 1, status text, created_at bigint not null);
alter table conversations enable row level security;
alter table messages enable row level security;
alter table drafts enable row level security;
alter table events enable row level security;
alter table kv enable row level security;
alter table accounts enable row level security;
`);

const COPY = {
  accounts: ["id", "kind", "label", "address", "provider", "config", "secret", "enabled", "can_send", "status", "created_at"],
  kv: ["k", "v"],
  conversations: ["id", "channel", "external_id", "account", "name", "company", "project", "subject", "status", "suggestion", "suggestion_for", "reminded_at", "demo", "created_at"],
  messages: ["id", "conv_id", "direction", "kind", "text", "transcript", "media_path", "media_mime", "external_id", "ack", "sent_by", "status", "via", "created_at"],
  drafts: ["id", "conv_id", "project", "author", "text", "status", "created_at"],
  events: ["source", "payload", "created_at"],
};

for (const [table, cols] of Object.entries(COPY)) {
  const have = lite.prepare(`pragma table_info(${table})`).all().map((c) => c.name);
  const use = cols.filter((c) => have.includes(c));
  const rows = lite.prepare(`select ${use.join(", ")} from ${table}`).all();
  let copied = 0;
  for (const r of rows) {
    const values = use.map((c) => (r[c] === undefined ? null : r[c]));
    const res = await sql.unsafe(
      `insert into ${table} (${use.join(", ")}) values (${use.map((_, i) => `$${i + 1}`).join(", ")})${table === "events" ? "" : " on conflict do nothing"}`,
      values,
    );
    copied += res.count ?? 0;
  }
  console.log(`${table.padEnd(14)} ${rows.length} rows in SQLite, ${copied} copied`);
}

const counts = await sql`select (select count(*) from conversations) c, (select count(*) from messages) m, (select count(*) from accounts) a, (select count(*) from kv) k`;
console.log("Supabase now has:", counts[0]);
await sql.end();
