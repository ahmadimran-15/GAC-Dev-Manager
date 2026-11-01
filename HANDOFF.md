# GAC Desk — Full Handoff (read this first)

> **For the next Claude session:** this file is the complete record of what was built in the previous chat, what is
> tested, what is half-done, and exactly what to do next. Read it fully, then `README.md`, then continue from
> **§9 Next steps**. Work in `D:\GetAichatbots_Company\Gac Dev Manager Portal`. Never print secrets from `.env` in chat.

---

## 1. Who / what

- **Owner:** Muhammad Ahmad (m.ahmad@getaichatbots.com), dev manager / team lead at GetAI Chatbots (GAC), AI-automation agency.
- **Goal:** one private dashboard so the owner (and boss) sees **every client message from every channel** (WhatsApp, Slack,
  email — Titan/Gmail/etc.; Outlook/Teams later), replies fast (AI-drafted), never forgets a reply (reminders), and sees the
  team's ClickUp work, time and performance. **Security goal:** the team must never hold client contact details or channel
  access (a teammate once stole a client by quoting a different price). All client channels flow to the owner only; the team
  submits updates through a portal and the owner approves and sends.
- **User preferences learned:**
  - Wants a **minimal, light, clean UI** (rejected two dark "dashboard" designs). Current design = light, off-white
    `#f7f7f5`, hairline borders, one dark accent `#171717`, Inter font. Keep this style.
  - Wants **live data only** (no demo data) — `SEED_DEMO=0`.
  - Wants things **actually tested end to end**, honest status, and short clear explanations.
  - Speaks English/Urdu/Hindi; voice input matters.
  - ClickUp stays the system of record for tasks; the team uses ClickUp + task comments (Looms, work notes).
  - Free / open-source preferred (e.g. local Whisper instead of paid STT).
  - Outlook / Microsoft Teams: **skip for now** (owner said so).

---

## 2. Stack & architecture

- **Next.js 15.5 (App Router)** — UI and API in one Node process. `npm run build` → `npm run start` (port 3000).
- **Tailwind 4**, lucide-react icons, Inter via `next/font`.
- **Database: Supabase Postgres** via `postgres` (postgres.js v4) — **session pooler, port 5432**
  (`aws-1-eu-central-1.pooler.supabase.com`, user `postgres.awgnbreyemfrjunojxqx`). **Do NOT use the transaction pooler
  6543** — it froze under the app's parallel queries (reproduced: 6543 timed out, 5432 fine).
  - Falls back to local SQLite (`node:sqlite`, `data/local.db`) when `DATABASE_*` is empty.
  - **Row-level security enabled on every table, zero policies** → Supabase's public REST API can't read anything; the
    server connects as owner and is unaffected. Keep RLS on for any new table (`TABLES` list in `lib/db.ts`).
  - Schema is created/migrated automatically on first query (`lib/db.ts`: `schema()`, `PG_MIGRATIONS`, `SQLITE_MIGRATIONS`).
  - `scripts/sqlite-to-postgres.mjs` copies a local SQLite DB into Supabase (already run once).
- **Background worker** started in `instrumentation.ts` → `lib/inbound.ts:startWorker()`:
  email polling every 60 s, WhatsApp reminders every 60 s, health checks every 10 min, reply suggestions after restart.
- **Gemini** = owner's custom web-to-API server (OpenAI-compatible): `https://custom-model.duckdns.org/v1`,
  model `gemini-4-argon`, header `X-Session-Id`. It answers as chat text, so every prompt says "plain text; JSON inside a
  ```json block" (`lib/ai.ts` PREFIX). **It cannot read audio** (tested 3 formats).
- **Speech-to-text:** free **local Whisper** inside the server (`@huggingface/transformers` + `ffmpeg-static`), model
  `onnx-community/whisper-small` on the PC (use `whisper-base`/`-tiny` on a 1 GB VM). Custom English/Urdu/Hindi language
  detection (Transformers.js always assumes English otherwise). Urdu/Hindi transcripts get an English translation via Gemini.
  Model auto-unloads after 10 idle minutes. Optional Whisper API via `STT_PROVIDER=api`.
- **WhatsApp:** owner's self-hosted **ChatSlash / OpenWA gateway** `https://ahmad-wasender.duckdns.org` (Swagger at
  `/api/docs`, JSON at `/api/docs-json`). Session id in `.env` (`WA_SESSION_ID`, name "personal", phone 923074973015).
  - Send: `POST /api/sessions/{sid}/messages/send-text` `{chatId:"923…@c.us" | "…@g.us", text}`, header `x-api-key`.
  - Webhook events: `message.received`, `message.sent`; signature header `X-OpenWA-Signature: sha256=<hmac>`.
  - Media: `GET /api/sessions/{sid}/messages/{chatId}/{messageId}/media`.
  - Groups: `GET …/groups` (188), contacts `GET …/contacts?limit=1000&offset=` (1,478). Start session `POST …/start`, QR `GET …/qr`.
  - The gateway **went down once (502)** and came back "disconnected/Session is not started" then auto-recovered to "ready".
    Health check now detects this and offers "Start session" / "Show QR".
  - Owner also has an **n8n webhook** on the same session (`automations-n8n.duckdns.org/...`) — never delete it.
- **ClickUp:** API token in `.env`; workspace **"GetAi ChatBots"** id `9009178151`; plan **Free Forever**
  (⇒ API can only log time for the token owner "Muhammad Ahmad" id 101441563; nobody uses ClickUp's timer — 0 entries).
  - Structure: Space "Dev Side" → folders = project **stages**: **Current Projects** (20 lists, id 90180515911),
    Pending From Client, Dev Completed Projects, Loom Videos, New Task Details, Inter Tasks, Approvals.
    **Each list = a project; list "status" field = project owner's name.**
  - The folder filter (`project_ids[]`) is ignored by ClickUp → we filter by **`list_ids[]` of the current lists** (315 tasks).
  - New tasks go into the project's list in Current Projects; a new project name creates a new list there.
  - 5 existing ClickUp webhooks belong to the owner's n8n — leave them.
- **Tunnel (testing only):** `cloudflared` is installed at `C:\Program Files (x86)\cloudflared\cloudflared.exe`.
  Quick tunnel currently gives `https://defining-measures-scored-gif.trycloudflare.com` (**changes on every restart**).
  `PUBLIC_URL` in `.env` must match; then Settings → Register webhook again.
- **GitHub:** private repo `https://github.com/ahmadimran-15/GAC-Dev-Manager` (branch `main`). Token in `.env`
  (`GITHUB_TOKEN`). Push without storing the token:
  `git -c credential.helper= push "https://x-access-token:${TOKEN}@github.com/ahmadimran-15/GAC-Dev-Manager.git" main:main`
  (pipe output through `sed "s/${TOKEN}/***/g"`). Always confirm with the owner before pushing.
- **Hosting target:** Google Cloud free e2-micro (1 GB) + DuckDNS domain. Scripts: `deploy/setup.sh <repo> <domain>`
  (2 GB swap, Node 22, Caddy HTTPS, systemd), `deploy/update.sh`. Private repo ⇒ VM needs the token to clone.

---

## 3. `.env` keys (names only — values are in the file, never echo them)

`ADMIN_EMAIL`, `ADMIN_PASSWORD` (only seeds the first owner login; DB is now the source of truth), `AUTH_SECRET`
(signs sessions AND derives the AES key for stored account passwords — changing it breaks stored secrets),
`PUBLIC_URL`, `GEMINI_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_SESSION_ID`,
`STT_PROVIDER`, `LOCAL_WHISPER_MODEL`, `STT_LANGUAGES`, `STT_IDLE_MINUTES`, `VOICE_COMMANDS` (browser|whisper),
`WHISPER_BASE_URL/API_KEY/MODEL` (optional API), `WA_BASE_URL`, `WA_SESSION_ID`, `WA_API_KEY`, `WA_WEBHOOK_SECRET`,
`REMINDER_WHATSAPP_TO` (owner's number), `REMINDER_MINUTES`, `REMINDER_AFTER_MINUTES`, `CLICKUP_TOKEN`, `CLICKUP_TEAM_ID`,
`EMAIL1_*`, `EMAIL2_*` (only used for the one-time import into the accounts table), `TEAM_TOKENS` (obsolete),
`GITHUB_REPO_LINK`, `GITHUB_TOKEN`, `DATABASE_HOST`, `DATABASE_PORT=5432`, `DATABASE_NAME`, `DATABASE_USER`,
`DATABASE_PASSWORD`, `SEED_DEMO=0`. Optional: `HEALTH_MINUTES`, `DATABASE_POOL`, `CLICKUP_CURRENT_FOLDER(_ID)`.

**Owner login:** email `m.ahmad@getaichatbots.com`; password = the `ADMIN_PASSWORD` value (was shown to the owner in
chat — they were told to change it in Settings → Logins). Stored scrypt-hashed in Supabase `users`.

---

## 4. Code map

```
middleware.ts            auth gate; team role only reaches /portal + /api/portal; sliding session renewal
instrumentation.ts       starts the background worker
lib/db.ts                driver (Postgres/SQLite), schema + migrations, all/get/run (async, `?` placeholders), kv, logEvent
lib/session.ts           signed cookie {id,email,name,role,exp}; isHttps(req) → secure flag
lib/auth.ts              currentUser(), requireAdmin()
lib/users.ts             users table, scrypt hashing, ensureAdmin() seeds owner from env, CRUD
lib/crypto.ts            AES-256-GCM for account secrets (key from AUTH_SECRET)
lib/accounts.ts          mailboxes + WhatsApp numbers (table accounts), presets (titan/gmail/zoho/outlook/yahoo/custom),
                         defaultSender(), one-time import from .env
lib/email.ts             IMAP poll (imapflow, UID tracking in kv, never marks read, skips own/automated mail),
                         SMTP send (nodemailer), testMailbox()
lib/whatsapp.ts          ChatSlash client: send, sessionStatus, listSessions, registerWebhook (keeps n8n), verifySignature,
                         parseIncoming (groups supported), downloadMedia, listTargets (groups/contacts, 10-min cache),
                         startSession, sessionQr
lib/groups.ts            tracked WhatsApp groups (kv "wa_groups"); auto-added when you message a group
lib/inbound.ts           handleWhatsApp, afterIncoming (Gemini suggestion after 4 s debounce), sendToConversation
                         (From picker), sendToTarget (any group/contact/email), email alerts, WhatsApp reminders, worker
lib/store.ts             conversations/messages/drafts; summaries() = 2 queries for the whole inbox; firstReplyToday
lib/ai.ts                chat(), polish, rewrite, suggestReply, draftTicket, interpret (assistant), answerFrom, transcribe
lib/stt.ts               local Whisper / API, ffmpeg decode, language detection, queue, idle unload
lib/clickup.ts           board() (current projects only, 60 s cache), taskDetail (comments/attachments/Looms),
                         searchTasks, createTask, projectStage, + NEW (untested): invalidateBoard, taskStatuses,
                         setTaskStatus, markInProgress, clickupMe, pushTimeEntry, registerClickupWebhook
lib/search.ts            assistant searches: ClickUp tasks+comments, IMAP mailboxes, stored chats
lib/health.ts            runHealth(): DB, Gemini, ClickUp, each WhatsApp number, each mailbox, STT, public URL → kv "health"
lib/timers.ts            NEW (untested): server-clock timers, one running per person, stop pushes to ClickUp for token owner,
                         minutesByTask/Person, status_log helpers
lib/estimates.ts         NEW (untested): my estimate + Gemini AI projection from the person's history
lib/demo.ts              demo seed (disabled by SEED_DEMO=0) + DEMO tasks fallback when no ClickUp token
lib/use-voice.ts         browser speech (Web Speech) or record → /api/stt

app/(app)/               owner pages: page.tsx (Overview), inbox, team, settings, loading.tsx (branded loader)
app/portal/page.tsx      team member's only page: send update (project + optional client) + "Your updates" status + password
app/login/page.tsx       login (team → /portal)
app/api/…                state, conversations/[id], drafts/[id] (approve to conv or any target), send-to, whatsapp/targets,
                         accounts, users, portal, groups, health, ai, assistant, tasks, tasks/[id], team, stt, media/[file],
                         admin/clear-demo, auth/login|logout, webhooks/whatsapp (HMAC or ?key=), webhooks/clickup (NEW)
components/              Live (polling context, api helper, toast), TopNav (health badge), Reminders (popup + instant alerts),
                         Assistant (chat; voice), WaitingCard, DraftCard (approve: reply or RecipientPicker), RecipientPicker
                         (WhatsApp groups/contacts search, email From/To), Composer (new message), FromPicker, TaskDrawer,
                         AccountsManager, HealthPanel, LoginsManager, GroupsManager, Skeleton, ui
```

---

## 5. What is DONE and TESTED (live, as of 2026-11-02)

| Area | State |
|---|---|
| Login | Owner + team logins in Supabase (scrypt). Team blocked from owner pages/APIs (403 / redirect to /portal). Team logins can be linked to a ClickUp member (Settings → Logins dropdown). |
| Live data only | `SEED_DEMO=0`. All test rows created while testing were deleted (drafts, timers, estimates, test logins). |
| WhatsApp in | Signed webhook on the gateway (events `message.received, message.sent, message.ack, message.failed`) next to the owner's n8n webhook (untouched). Gateway test delivery → 200. |
| WhatsApp history import | `lib/backfill.ts`: walks the gateway's message log (`GET /messages?after=` keyset, 100/page) on startup, on session reconnect, and Settings → "Import recent chats". 7 days imported (~2,700 msgs, 35 direct chats + 12 client groups). Groups are imported only if a team number is a member/wrote, or already tracked (family groups were wrongly imported once and removed). New chats whose last client message is >24 h old are marked handled. |
| Our side | Settings → "Our side: team numbers" (kv `team_numbers`, default Abdullah +1 305 508 3815). Their messages in a group = our reply ("Replied by Abdullah"); direct chat with them = internal. "Not a client" button for personal chats. Sender names instead of raw `@c.us`/`@lid` ids (lid resolved via gateway `/contacts/{id}/phone`). |
| Delivery ticks | ✓ sent, ✓✓ delivered, blue ✓✓ read, red ! failed — from `message.ack` + 2-min sync fallback. |
| Replies | Reply box (inbox + waiting cards): voice → text, **Generate** turns a draft/instruction into the message, `@Name` → real WhatsApp mention, every WhatsApp send quotes the client's last message (falls back to unquoted). Guard rejects Gemini "app/permission" prompts and notes-to-manager. **Not yet verified with a real send.** |
| AI context | Per-conversation summary box (all channels, hideable), ClickUp task "Get context" (+ Looms). |
| Gemini | ONE session id for all calls (`GEMINI_SESSION_ID="sessiond id3"`, from the owner's curl) + a queue so calls don't overlap — per-feature ids caused the server's new-chat rate limit. Broken emoji stripped before sending. Server sometimes answers "Google session expired / throttled" → owner reconnects Google on that server. |
| ClickUp | Two-way status sync (dropdown in Team table + panel writes to ClickUp; webhook logs ClickUp-side changes, signed, no echo duplicates). Webhook auto-registers at PUBLIC_URL. Priority shown + **Sort** (priority/due/person/status/project). |
| Estimates | Your private estimate + Gemini's. Gemini is **strict/low** (team builds with Claude: small fix 30–45 min, feature 1–3 h, big 4–8 h max). Batch "Estimate open tasks" button + every 10 min in the background. |
| Team page | Full names, tracked/estimate column, per-project time breakdown (click a project: total, per person tasks/time/estimate), right-side tabs **Current projects / Team performance** (stacked bars per person: done · in progress · open). |
| Tickets | Inbox → select messages → Gemini picks project + assignee from your words ("internal tasks, assign to Muhammad Ahmed") → ClickUp; linked tickets shown in the thread header. |
| Reminders | Per-client "Remind after"; WhatsApp + email (REMINDER_EMAIL_TO) summaries say "client group" and cap at 15. |
| Inbox UI | Clear header dropdowns (custom searchable `components/Dropdown.tsx`), open chat highlighted, unread dot, channel filter (WhatsApp / groups / email / mailbox / not clients). |
| Settings | Edit mailboxes (provider/address/password — tests before saving) and WhatsApp numbers (name/URL/key). Team numbers, import, ClickUp webhook button. |
| Supabase | 11 tables, RLS on everywhere, zero policies; session pooler 5432. |
| GitHub | **Nothing pushed this session.** Local commits since `aa5b107`: `c9bfb72` … latest (see `git log`). Ask before pushing. |

---

## 6. ⏸ TIMERS — BUILT, SWITCHED OFF, NEED THE OWNER'S APPROVAL TO TURN ON

**Do not switch timers on without the owner saying so.** The owner will connect GAC Desk to the team's own
**tracking portal** first (they will provide its APIs) so that breaks pause the clock, etc.

What exists (`lib/timers.ts`):
- Master switch kv `timers_on` (`"0"` now). Team page → "Timers on/off" button, `POST /api/timers {action:"enabled", on}`.
  While off: every start is refused (owner Start buttons, portal "My tasks", status sync) and the buttons are hidden.
- Status-driven rule (owner's spec): ClickUp status **in progress** or **revision** → timer runs for the assignee;
  any other status → paused; complete/closed → stopped, task total final. Implemented as `syncStatusTimers(tasks)`
  (acts only on status *changes*, stored in kv `status_seen`), called by the ClickUp webhook, by the status dropdown,
  and by the worker every 2 min. Timers for tasks that left Current Projects are stopped.
- Manual Start/Pause still exists (one running timer per person) and portal "My tasks".
- Free ClickUp plan ⇒ only the token owner's time is copied to ClickUp as a time entry ("GAC Desk timer").
- **To do when the owner approves:** plug in the tracking-portal API (break/active state per person → pause/resume),
  then switch on. Turning on clears `status_seen`, so only changes from that moment start clocks.

Incident on 2026-11-02: before the switch existed, status sync auto-started 23 timers (~45 min total). Timers were
switched off; the 23 local rows (`timers.started_by = 'ClickUp status'`) and **3 ClickUp time entries** (2 min each,
description "GAC Desk timer", on the owner's tasks MJP Electrical landing page / MJP Dashboard / Dev team ClickUp
cleanup) still exist — deleting them was blocked by the permission check and is waiting for the owner's OK.

---

## 7. Still to build

1. **Slack** — NOT started. Plan: Slack app **from a manifest** (prefilled link
   `https://api.slack.com/apps?new_app=1&manifest_json=<urlencoded>`), **Socket Mode**, user-token scopes
   `channels:history groups:history im:history mpim:history channels:read groups:read im:read mpim:read users:read chat:write`,
   user events `message.channels message.groups message.im message.mpim`. Owner pastes **User OAuth Token (xoxp-)** +
   **App-Level Token (xapp-, connections:write)**. Worker: `apps.connections.open` → WebSocket → conversations channel
   `slack`; send with `chat.postMessage`; health `auth.test`.
2. **Messaging the team** from GAC Desk — the owner will explain how later. Don't build yet.
3. Bot replies: the owner's **n8n WhatsApp bot** answers on the same number, so its replies count as "answered". Option
   offered (not decided): flag bot replies so the client still shows as waiting.
4. Outlook / Teams — skipped by owner for now.

---

## 8. Known issues / owner to-dos

- **Titan mailbox:** login fails (wrong password or app access off) → Settings → Edit.
- **Gmail:** saved as `jimaesmith9871@gmail.com`, owner wrote `jimmysmith9871@gmail.com`; needs an **App Password** → Settings → Edit.
- Yusuf's number and the company number → Settings → team numbers.
- Tunnel URL changes when cloudflared restarts → update PUBLIC_URL, restart, Register both webhooks. Final fix = VM + DuckDNS.
- Secrets pasted in chat (rotate): WhatsApp gateway API key (in an n8n snippet), Gemini API key (in a curl), owner password (still the `.env` value).
- The n8n bot once answered a client with Gemini's own "permission to turn on the Shopify app" prompt — that's in n8n, not GAC Desk.

---

## 9. How to run / operate

```bash
cd "D:/GetAichatbots_Company/Gac Dev Manager Portal"
npm run build && npm run start          # http://localhost:3000 (runs in a terminal tab)
"/c/Program Files (x86)/cloudflared/cloudflared.exe" tunnel --no-autoupdate --url http://localhost:3000   # public URL
```
- **Build first, then restart** (≈1 s downtime). Check a build without touching the live one:
  `NEXT_DIST_DIR=.next-test npx next build` (`next build` catches type errors `tsc --noEmit` sometimes misses).
  A side-by-side test server: `.claude/launch.json` "test-build" (port 3100, `DISABLE_WORKER=1`).
- API errors return **500, never 502**: Cloudflare replaces 502/503/504 with its own HTML page.
- Test pattern: log in with curl (`/api/auth/login`, cookie jar). Temporary logins use `@example.invalid` and are deleted after.
- Use the Edit/Write tools for code changes, not shell string surgery.

---

## 10. Next steps (in order)

1. Owner decides on the 3 ClickUp time entries + 23 local timer rows from the incident (§6).
2. Test-send a WhatsApp message to the owner's own number (with OK) → check ticks, reply-quote, @mention.
3. Build Slack (§7.1); owner pastes xoxp + xapp tokens.
4. Owner fixes Titan + Gmail in Settings → Edit.
5. Owner gives the tracking-portal APIs → wire breaks into timers → owner approves → switch timers on (§6).
6. Ask before pushing to GitHub; then deploy to the Google VM (VM IP + DuckDNS), PUBLIC_URL, re-register webhooks, `whisper-base`.
