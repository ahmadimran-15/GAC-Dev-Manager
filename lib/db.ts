import fs from "fs";
import path from "path";
import postgres from "postgres";
import type { DatabaseSync } from "node:sqlite";
import { seedDemo } from "@/lib/demo";

// Database: Supabase Postgres when DATABASE_HOST/DATABASE_PASSWORD are set, otherwise a local
// SQLite file (data/local.db) for offline development. Queries are written once with `?` placeholders.

export const DATA_DIR = path.join(process.cwd(), "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
type Param = string | number | bigint | null;

interface Driver {
  kind: "postgres" | "sqlite";
  all(q: string, p: Param[]): Promise<Row[]>;
  exec(q: string): Promise<void>;
}

export const usingPostgres = () => !!(process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD);

const TABLES = ["conversations", "messages", "drafts", "events", "kv", "accounts", "users", "timers", "estimates", "task_links", "status_log"];

const schema = (pg: boolean) => {
  const big = pg ? "bigint" : "integer";
  return `
create table if not exists conversations (
  id text primary key,
  channel text not null,
  external_id text not null,
  account text not null default '',
  name text not null,
  company text,
  project text,
  subject text,
  status text not null default 'open',
  suggestion text,
  suggestion_for text,
  reminded_at ${big},
  remind_after integer,
  demo integer not null default 0,
  created_at ${big} not null,
  unique (channel, external_id, account)
);
create table if not exists messages (
  id text primary key,
  conv_id text not null,
  direction text not null,
  kind text not null default 'text',
  text text,
  transcript text,
  media_path text,
  media_mime text,
  external_id text,
  ack integer not null default 0,
  sent_by text,
  status text,
  via text,
  created_at ${big} not null
);
create index if not exists messages_conv on messages (conv_id, created_at);
create unique index if not exists messages_ext on messages (conv_id, external_id) where external_id is not null;
create table if not exists drafts (
  id text primary key,
  conv_id text,
  project text,
  author text not null,
  author_id text,
  text text not null,
  status text not null default 'pending',
  sent_to text,
  created_at ${big} not null
);
create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null,
  role text not null default 'team',
  password_hash text not null,
  active integer not null default 1,
  clickup_name text,
  last_login ${big},
  created_at ${big} not null
);
create table if not exists timers (
  id text primary key,
  task_id text not null,
  task_title text not null,
  project text,
  person text not null,
  started_at ${big} not null,
  ended_at ${big},
  started_by text,
  pushed integer not null default 0
);
create index if not exists timers_person on timers (person, started_at);
create index if not exists timers_task on timers (task_id);
create table if not exists estimates (
  task_id text primary key,
  my_min integer,
  ai_min integer,
  ai_note text,
  updated_at ${big} not null
);
create table if not exists task_links (
  task_id text primary key,
  conv_id text not null,
  message_ids text,
  title text not null,
  url text,
  project text,
  created_at ${big} not null
);
create table if not exists status_log (
  id text primary key,
  task_id text not null,
  task_title text,
  person text,
  from_status text,
  to_status text not null,
  source text not null,
  at ${big} not null
);
create index if not exists status_log_task on status_log (task_id, at);
create table if not exists events (
  id ${pg ? "bigint generated always as identity primary key" : "integer primary key autoincrement"},
  source text not null,
  payload text not null,
  created_at ${big} not null
);
create table if not exists kv (k text primary key, v text);
create table if not exists accounts (
  id text primary key,
  kind text not null,
  label text not null,
  address text not null,
  provider text not null,
  config text not null default '{}',
  secret text not null,
  enabled integer not null default 1,
  can_send integer not null default 1,
  status text,
  created_at ${big} not null
);
${
  // Supabase also serves tables over its public REST API. Row-level security with no policies
  // blocks that completely; this server connects directly as the owner and is unaffected.
  pg ? TABLES.map((t) => `alter table ${t} enable row level security;`).join("\n") : ""
}
`;
};

async function connectPostgres(): Promise<Driver> {
  const sql = postgres({
    host: process.env.DATABASE_HOST,
    // Use Supabase's SESSION pooler (port 5432). The transaction pooler (6543) is meant for serverless
    // functions and stalls under this server's parallel queries.
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME ?? "postgres",
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: "require",
    prepare: false,
    max: Number(process.env.DATABASE_POOL ?? 5),
    idle_timeout: 60,
    connect_timeout: 20,
    onnotice: () => {}, // "table already exists" notices on every start
    // int8 (counts, timestamps in ms) as plain numbers
    types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
  });
  return {
    kind: "postgres",
    async all(q, p) {
      let i = 0;
      const text = q.replace(/\?/g, () => `$${++i}`);
      return [...(await sql.unsafe(text, p as never[]))] as Row[];
    },
    async exec(q) {
      await sql.unsafe(q);
    },
  };
}

function connectSqlite(): Driver {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const d: DatabaseSync = new DatabaseSync(path.join(DATA_DIR, "local.db"));
  d.exec("pragma journal_mode = wal; pragma busy_timeout = 3000;");
  return {
    kind: "sqlite",
    async all(q, p) {
      const s = d.prepare(q);
      return /^\s*(select|with|pragma)/i.test(q) || /\breturning\b/i.test(q) ? (s.all(...p) as Row[]) : (s.run(...p), []);
    },
    async exec(q) {
      d.exec(q);
    },
  };
}

// Columns added after the first release (SQLite files created before them)
const SQLITE_MIGRATIONS: [table: string, column: string, type: string][] = [
  ["messages", "via", "text"],
  ["drafts", "author_id", "text"],
  ["drafts", "sent_to", "text"],
  ["users", "clickup_name", "text"],
  ["conversations", "remind_after", "integer"],
];
// Same for Postgres databases created before them
const PG_MIGRATIONS = [
  "alter table drafts add column if not exists author_id text",
  "alter table drafts add column if not exists sent_to text",
  "alter table users add column if not exists clickup_name text",
  "alter table conversations add column if not exists remind_after integer",
];

const g = globalThis as unknown as { __gacDriver?: Promise<Driver>; __gacSeeded?: boolean };

function driver(): Promise<Driver> {
  if (!g.__gacDriver) {
    g.__gacDriver = (async () => {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      const d = usingPostgres() ? await connectPostgres() : connectSqlite();
      if (d.kind === "postgres") for (const m of PG_MIGRATIONS) await d.exec(m).catch(() => {}); // before the schema: older tables need the columns first
      await d.exec(schema(d.kind === "postgres"));
      if (d.kind === "sqlite") {
        for (const [table, column, type] of SQLITE_MIGRATIONS) {
          const cols = await d.all(`pragma table_info(${table})`, []);
          if (!cols.some((c) => c.name === column)) await d.exec(`alter table ${table} add column ${column} ${type}`);
        }
      }
      return d;
    })();
    g.__gacDriver.catch(() => (g.__gacDriver = undefined));
  }
  return g.__gacDriver;
}

export const dbKind = async () => (await driver()).kind;

const clean = (p: unknown[]): Param[] => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : (v as Param)));

export async function all<T = Row>(q: string, ...p: unknown[]): Promise<T[]> {
  const d = await driver();
  if (!g.__gacSeeded) {
    g.__gacSeeded = true;
    if (process.env.SEED_DEMO !== "0") await seedDemo().catch(() => {});
  }
  return (await d.all(q, clean(p))) as T[];
}

export const get = async <T = Row>(q: string, ...p: unknown[]) => (await all<T>(q, ...p))[0] as T | undefined;
export const run = async (q: string, ...p: unknown[]) => {
  await all(q, ...p);
};

export const uid = (prefix = "") => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function kvGet(k: string) {
  return (await get<{ v: string }>("select v from kv where k = ?", k))?.v;
}
export async function kvSet(k: string, v: string) {
  await run("insert into kv (k, v) values (?, ?) on conflict (k) do update set v = excluded.v", k, v);
}

export async function logEvent(source: string, payload: unknown) {
  await run("insert into events (source, payload, created_at) values (?, ?, ?)", source, JSON.stringify(payload).slice(0, 20000), Date.now());
  await run("delete from events where id not in (select id from events order by id desc limit 300)");
}
