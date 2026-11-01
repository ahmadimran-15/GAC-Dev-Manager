import fs from "fs";
import path from "path";
import type { DatabaseSync } from "node:sqlite";
import { seedDemo } from "@/lib/demo";

// Single-file SQLite database (Node's built-in driver, no native install needed).
export const DATA_DIR = path.join(process.cwd(), "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");

type Param = string | number | bigint | null | Uint8Array;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const g = globalThis as unknown as { __gacDb?: DatabaseSync };

const SCHEMA = `
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
  reminded_at integer,
  demo integer not null default 0,
  created_at integer not null,
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
  created_at integer not null
);
create index if not exists messages_conv on messages (conv_id, created_at);
create unique index if not exists messages_ext on messages (conv_id, external_id) where external_id is not null;
create table if not exists drafts (
  id text primary key,
  conv_id text,
  project text,
  author text not null,
  text text not null,
  status text not null default 'pending',
  created_at integer not null
);
create table if not exists events (
  id integer primary key autoincrement,
  source text not null,
  payload text not null,
  created_at integer not null
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
  created_at integer not null
);
`;

// Columns added after the first release
const MIGRATIONS: [table: string, column: string, type: string][] = [["messages", "via", "text"]];

export function db(): DatabaseSync {
  if (g.__gacDb) return g.__gacDb;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const d = new DatabaseSync(path.join(DATA_DIR, "local.db"));
  d.exec("pragma journal_mode = wal; pragma busy_timeout = 3000;");
  d.exec(SCHEMA);
  for (const [table, column, type] of MIGRATIONS) {
    const cols = d.prepare(`pragma table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`alter table ${table} add column ${column} ${type}`);
  }
  g.__gacDb = d;
  if (process.env.SEED_DEMO !== "0") seedDemo();
  return d;
}

const clean = (p: unknown[]): Param[] => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : (v as Param)));

export const all = <T = Row>(sql: string, ...p: unknown[]) => db().prepare(sql).all(...clean(p)) as T[];
export const get = <T = Row>(sql: string, ...p: unknown[]) => db().prepare(sql).get(...clean(p)) as T | undefined;
export const run = (sql: string, ...p: unknown[]) => db().prepare(sql).run(...clean(p));

export const uid = (prefix = "") => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function kvGet(k: string) {
  return get<{ v: string }>("select v from kv where k = ?", k)?.v;
}
export function kvSet(k: string, v: string) {
  run("insert into kv (k, v) values (?, ?) on conflict (k) do update set v = excluded.v", k, v);
}

export function logEvent(source: string, payload: unknown) {
  run("insert into events (source, payload, created_at) values (?, ?, ?)", source, JSON.stringify(payload).slice(0, 20000), Date.now());
  run("delete from events where id not in (select id from events order by id desc limit 300)");
}
