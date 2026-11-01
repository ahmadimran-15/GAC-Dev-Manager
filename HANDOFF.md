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

## 5. What is DONE and TESTED (live)

| Area | State |
|---|---|
| Login | Owner + team logins in Supabase (scrypt). Wrong password rejected. Team blocked from owner pages/APIs (403 / redirect to /portal). Sessions auto-renew. |
| Live data only | Demo data deleted, `SEED_DEMO=0`. Supabase had 0 conversations at handoff. |
| WhatsApp in | Signed webhook registered on the gateway next to n8n; gateway test delivery → 200; messages stored as "waiting"; own phone replies recorded; groups only if tracked. |
| WhatsApp out | Send from conversation with From picker; new message to any group (188) / contact (1,478) with search (tested search; **no real message was sent in tests**). |
| Email | IMAP/SMTP code + accounts UI + Test connection. **Both mailboxes fail login** (see §7). |
| AI | Suggested replies auto-drafted (tested), polish, ticket drafting from Urdu/Roman-Urdu instructions, assistant (reply / task / search ClickUp+email+chats / answer). "Find the Loom for Aman" searched ClickUp correctly. |
| Ticketing | Select messages → instructions (voice/text) → Gemini draft → edit → create in ClickUp current project (or new list). |
| Team portal | Teammate submits update (project + optional client); owner approves → reply in client chat **or** send anywhere (RecipientPicker); discard; teammate sees status. Tested end to end (test user deleted after). |
| Reminders | Popup every N min with drafted replies + snooze, instant new-message alert + chime + desktop notification, WhatsApp summary to owner, new-email alert to owner's WhatsApp. |
| Quick acknowledge | One click, same channel. |
| Health | Checks every 10 min + "Check now"; top-bar "N issues" badge; Start session / Show QR for WhatsApp. At handoff: DB, tunnel, ClickUp, WhatsApp, STT, Gemini OK; 2 mailboxes red. |
| STT | Local Whisper small tested through `/api/stt` (perfect English transcript, free/offline). |
| Team page | Live ClickUp: people cards, 20 current projects with owners, tasks table, task panel with comments + Loom links. |
| Supabase | Migration done, RLS on, session pooler, ~0.5 s dashboard poll. |
| GitHub | Pushed up to commit `aa5b107`; **commit `c9bfb72` (logins/picker/health) is local, not pushed.** |

---

## 6. IN PROGRESS when the chat ended (code written, NOT wired, NOT type-checked)

Owner's original list (and their latest message) asked for these; status:

1. **Two-way ClickUp status sync** — written: `lib/clickup.ts` (taskStatuses, setTaskStatus, registerClickupWebhook),
   `app/api/webhooks/clickup/route.ts` (verifies `X-Signature` with secret stored in kv `clickup_webhook`, logs to
   `status_log`, invalidates board, stops timers when a task is done).
   **TODO:** registration action (call `registerClickupWebhook(\`${PUBLIC_URL}/api/webhooks/clickup\`)`, save
   `{id, secret, endpoint}` to kv `clickup_webhook`; run on startup when PUBLIC_URL changes + button in Settings);
   API `app/api/tasks/[id]/status/route.ts` (GET options, POST {status} → setTaskStatus + logStatus source "dashboard");
   status dropdown in Team table + TaskPanel; show recent changes (recentStatusChanges) on Overview/Team.
2. **Time tracking (start/stop per person per task)** — written: `lib/timers.ts`, tables `timers`, `status_log`.
   **TODO:** `app/api/timers/route.ts` (GET running + minutes; POST start {taskId,title,project,person} / stop {id});
   owner: Start/Stop for any assignee in Team table & panel, live running timers ("Working now") with ticking clock;
   team: portal "My tasks" (map login → ClickUp username via new `users.clickup_name`; add a ClickUp-member dropdown in
   LoginsManager create/edit) with Start/Pause/Stop; show tracked time vs estimate. Free plan ⇒ only the owner's time is
   copied to ClickUp; everyone else's lives in `timers` (this is the tamper-proof log).
3. **Performance dashboard + estimates** — written: `lib/estimates.ts` (setMyEstimate, aiEstimate, estimatesMap).
   **TODO:** `app/api/tasks/[id]/estimate/route.ts` (POST {myMin} or {ai:true}); show "Your estimate" (owner only) + "AI
   projection" (+reason) in TaskPanel and table; performance section per person: open/done, tracked today/week
   (minutesByPerson), estimate accuracy (tracked vs my_min), on-time (done before due).
4. **Ticket ↔ message links** — table `task_links` exists. **TODO:** in `/api/tasks` POST accept `conv_id` +
   `message_ids`, insert into task_links after createTask (returns `id`, `url`); TaskDrawer send them; show linked tickets
   (with live ClickUp status) in the Inbox thread header.
5. **Per-client reminder time** — column `conversations.remind_after` exists. **TODO:** include `remindAfter` in
   ConvSummary; select in thread header (default/5/15/30/60 min); Reminders.tsx + remindOnWhatsApp use it.
   **Email reminder:** add `REMINDER_EMAIL_TO`, send summary from the first working mailbox.
6. **Rewrite with instruction** for team drafts — removed during the DraftCard rewrite; re-add the instruction input +
   "Rewrite" (API `mode:"rewrite"` already exists). **Portal rate limit:** ~30 submissions/hour per user.
7. **Slack** — NOT started. Plan (agreed approach): Slack has no QR login. Create a Slack app **from a manifest** (prefilled
   link `https://api.slack.com/apps?new_app=1&manifest_json=<urlencoded>`) with **Socket Mode** (no public URL needed),
   user-token scopes `channels:history groups:history im:history mpim:history channels:read groups:read im:read mpim:read
   users:read chat:write`, user events `message.channels message.groups message.im message.mpim`. Owner installs to their
   workspace and pastes **User OAuth Token (xoxp-)** + **App-Level Token (xapp-, connections:write)** in Settings → add
   account kind `slack` (secret JSON). Worker: `apps.connections.open` → WebSocket (Node 22 global WebSocket) → ack
   envelopes → message events → conversation channel `slack`, external_id = channel id; send via `chat.postMessage` with
   the user token (posts as the owner). RecipientPicker: Slack channels/DMs (`conversations.list`, `users.list`). Health:
   `auth.test`. Clients often join the owner's own workspace (incl. Slack Connect), so one install covers them.
8. Outlook / Teams — skipped by owner for now (needs Azure app, "Sign in with Microsoft").

After wiring: `npx tsc --noEmit` (slow, ~3–5 min), `npm run build`, restart, test each with curl, clean test data, commit.

---

## 7. Known issues / owner to-dos

- **Titan mailbox (m.ahmad@getaichatbots.com):** IMAP/SMTP "AuthenticationError" → wrong password or app access disabled.
- **Gmail:** saved as **jimaesmith9871@gmail.com** but owner wrote **jimmysmith9871@gmail.com** (typo) AND Google requires
  an **App Password** (2-Step Verification → App passwords). Fix in Settings → Mailboxes (remove + add, Test connection).
- Tunnel URL changes on restart → update PUBLIC_URL, restart, Settings → Register webhook. Final fix = VM + DuckDNS.
- ClickUp Settings row still shows the ClickUp webhook URL built from `window.location.origin` (localhost) — switch to
  `PUBLIC_URL` when wiring §6.1.
- Owner's password was shown in chat → remind them to change it.
- Supabase MCP was authenticated by the owner in a terminal, but it only loads in a **new** Claude session started in this
  folder (`.mcp.json` has `supabase` + `clickup`). The app itself uses the direct DB connection.

---

## 8. How to run / operate

```bash
cd "D:/GetAichatbots_Company/Gac Dev Manager Portal"
npm run build && npm run start          # http://localhost:3000
"/c/Program Files (x86)/cloudflared/cloudflared.exe" tunnel --no-autoupdate --url http://localhost:3000   # public URL
```
- Before rebuilding, free port 3000: PowerShell
  `$p=(Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess; Stop-Process -Id $p -Force`.
- Test pattern used: log in with curl (`/api/auth/login`, cookie jar), hit `/api/state`, etc. Fake WhatsApp webhook:
  POST to `/api/webhooks/whatsapp?key=$WA_WEBHOOK_SECRET` with a `message.received` body; **delete test rows afterwards**.
- Bash heredoc/`node -e` string replacement with backticks/`${}` got mangled several times — **use the Edit/Write tools for
  code changes**, not shell string surgery.
- `.env` parsing in shell: names are case-sensitive (owner once wrote `Database_password`).

---

## 9. Next steps (in order)

1. Wire §6.1–6.6 (APIs + UI), type-check, build, test, commit.
2. Build Slack (§6.7); give the owner the manifest link; owner pastes xoxp + xapp tokens; test receive + send.
3. Owner fixes Titan + Gmail credentials in Settings → test reading and sending (send a test only with owner's OK).
4. Ask the owner before pushing to GitHub; push `c9bfb72` + new commits.
5. Deploy to the Google VM (owner provides VM IP + DuckDNS subdomain), set PUBLIC_URL to the domain, register both
   webhooks (WhatsApp, ClickUp), switch Whisper to `whisper-base`.
6. Later: Outlook/Teams via Azure, GAC tracking app driving timers, code-QA pipeline (Semgrep/Gitleaks/Trivy/AI review).
