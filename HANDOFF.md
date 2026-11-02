# GAC Desk — Full Handoff (read this first)

> **For the next Claude session:** this file is the complete record of what is built, what is tested, what is switched
> off on purpose, and what to do next. Read it fully, then `README.md`, then do **§0 Start-up** and continue from
> **§11 Next steps**. Work in `D:\GetAichatbots_Company\Gac Dev Manager Portal`. Never print secrets from `.env` in chat.
> Last updated: 2026-11-02 (end of session 2). Latest commit: see `git log -1` (`0d37553` or later).

---

## 0. Start-up (the server and tunnel are NOT running between sessions)

1. Build and start the app in a visible terminal tab (it must keep running):
   `npm run build` then `npm run start` → http://localhost:3000
2. Start the public tunnel (second terminal tab):
   `"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:3000`
   → note the `https://….trycloudflare.com` URL it prints (**it changes every time**).
3. If the URL changed: put it in `.env` as `PUBLIC_URL`, restart the app (step 1), then in the dashboard
   Settings → WhatsApp numbers → **Register webhook**, and Settings → AI & tasks → **Register ClickUp webhook**
   (or `POST /api/accounts {"action":"register-webhook"}` and `POST /api/clickup` with the owner cookie).
   Our ClickUp webhook re-registers itself on startup when PUBLIC_URL changed. **Never touch the n8n webhooks.**
4. Check: `/login` 200 locally and through the tunnel; Settings → System health.
5. Give the owner the new tunnel URL.

---

## 1. Who / what

- **Owner:** Muhammad Ahmad (m.ahmad@getaichatbots.com), dev manager / team lead at GetAI Chatbots (GAC), AI-automation agency.
- **Goal:** one private dashboard so the owner (and boss) sees **every client message from every channel** (WhatsApp, email;
  Slack next; Outlook/Teams later), replies fast (AI-drafted), never forgets a reply (reminders), and sees the team's
  ClickUp work, time and performance. **Security goal:** the team never holds client contact details or channel access.
  All client channels flow to the owner only; the team submits updates through `/portal` and the owner approves and sends.
- **Owner's rules / preferences (follow them):**
  - **Minimal, light UI** (off-white `#f7f7f5`, hairline borders, dark accent `#171717`, Inter). Rejected dark dashboards.
    Wants controls that *look* clickable (bordered dropdowns, clear buttons), nothing overlapping, no repeated labels.
  - **Live data only** (`SEED_DEMO=0`). **Delete every test row you create.** Temporary logins use `@example.invalid`.
  - **Ask before pushing to GitHub** and **before sending any real message** (WhatsApp/email) to anyone.
  - Supabase **session pooler 5432** only; **RLS on every new table**.
  - **Never delete/modify the owner's n8n webhooks** (WhatsApp session + ClickUp).
  - Use the **Edit/Write tools** for code changes, not shell string replacement.
  - Test end to end and report honestly what works and what doesn't. Short, clear explanations.
  - Speaks English/Urdu/Hindi; voice input matters. Tests through the Cloudflare URL in Chrome.
  - Wants things fixed fast when they break (they notice downtime immediately) → build first, restart second (§10).
  - **Timers stay OFF until the owner explicitly approves** (§6).

---

## 2. Stack & architecture

- **Next.js 15.5 (App Router)**, UI + API in one Node process. **Every page renders dynamically**
  (`export const dynamic = "force-dynamic"` in `app/layout.tsx`): a prerendered page left in Next's route cache once
  outlived a rebuild and caused "Application error" (scripts 404). Keep it that way.
- **Tailwind 4**, lucide-react, Inter.
- **Database: Supabase Postgres** via postgres.js, **session pooler 5432** (`aws-1-eu-central-1.pooler.supabase.com`,
  user `postgres.awgnbreyemfrjunojxqx`). Never the transaction pooler 6543 (froze). SQLite fallback when `DATABASE_*` empty.
  11 tables, **RLS enabled, zero policies**: conversations, messages, drafts, events, kv, accounts, users, timers,
  estimates, task_links, status_log. Schema + migrations run automatically (`lib/db.ts`).
- **Background worker** (`instrumentation.ts` → `lib/inbound.ts:startWorker`, disabled by `DISABLE_WORKER=1`):
  email poll 60 s · reminders 60 s · health 10 min · WhatsApp session watch 2 min (import history when a session becomes
  ready) · delivery-tick sync 2 min · status timers 2 min (no-op while timers are off) · AI estimates for open tasks 10 min ·
  ClickUp webhook re-register on start.
- **Gemini** = owner's web-to-API server (OpenAI-compatible) `GEMINI_BASE_URL`, model `gemini-4-argon`.
  - **ONE fixed session for every call**: header `X-Session-Id: GEMINI_SESSION_ID` (`"sessiond id3"`, from the owner's curl).
    A new session id per call opens a new Gemini chat on the server and hits its rate limit — don't go back to that.
  - Calls run **one at a time** through a queue in `lib/ai.ts`: things the owner clicked (`chat(...)`) go **before**
    background jobs (`chat(..., { background: true })`: auto-suggestions, auto-summaries, batch estimates).
  - Prompt PREFIX: plain text, JSON in a ```json block, "don't use apps/extensions". Lone UTF-16 surrogates stripped
    (broken emoji crashed the server). Client-facing text goes through `clientMessage()` which rejects Gemini's own
    "permission to turn on the Shopify app" prompts / notes-to-manager (`META` regex), retries, then errors.
  - The server sometimes answers "Google session expired / throttled" → owner reconnects Google on that server.
  - It cannot read audio.
- **Speech-to-text:** local Whisper (`@huggingface/transformers` + ffmpeg), `whisper-small` on the PC (`whisper-base` on a 1 GB VM).
- **WhatsApp:** owner's ChatSlash/OpenWA gateway `WA_BASE_URL` (Swagger `/api/docs`, JSON `/api/docs-json`), session
  "personal", phone 923074973015. Details in §5 / §7.
- **ClickUp:** token in `.env`, workspace "GetAi ChatBots" `9009178151`, **Free Forever** (API logs time only for the token
  owner). Space "Dev Side" → folders = stages; **Current Projects** = 20 lists (each list = a project, list status = owner).
  We fetch tasks by `list_ids[]` of current lists (~315). 5 ClickUp webhooks belong to n8n — leave them.
- **Tunnel:** cloudflared quick tunnel (URL changes on restart). Cloudflare replaces origin **502/503/504** with its own
  HTML page → **our APIs return 500 on errors, never 502**.
- **GitHub:** private repo `ahmadimran-15/GAC-Dev-Manager`, branch `main`. Push without storing the token:
  `git -c credential.helper= push "https://x-access-token:${TOKEN}@github.com/ahmadimran-15/GAC-Dev-Manager.git" main:main`
  (mask output with `sed "s/${TOKEN}/***/g"`). **Last pushed: `aa5b107`. Everything after is local only. Ask first.**
- **Hosting target:** Google Cloud e2-micro + DuckDNS (`deploy/setup.sh`, `deploy/update.sh`). Not deployed yet.

---

## 3. `.env` keys (names only — never echo values)

`ADMIN_EMAIL`, `ADMIN_PASSWORD` (seeds the first owner login only), `AUTH_SECRET` (sessions + AES key for stored account
secrets — changing it breaks them), `PUBLIC_URL`, `GEMINI_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`GEMINI_SESSION_ID` (now `"sessiond id3"`), `STT_PROVIDER`, `LOCAL_WHISPER_MODEL`, `STT_LANGUAGES`, `STT_IDLE_MINUTES`,
`VOICE_COMMANDS`, `WHISPER_*` (optional), `WA_BASE_URL`, `WA_SESSION_ID`, `WA_API_KEY`, `WA_WEBHOOK_SECRET`,
`REMINDER_WHATSAPP_TO`, `REMINDER_MINUTES`, `REMINDER_AFTER_MINUTES`, `CLICKUP_TOKEN`, `CLICKUP_TEAM_ID`, `EMAIL1_*`,
`EMAIL2_*` (one-time import only), `GITHUB_REPO_LINK`, `GITHUB_TOKEN`, `DATABASE_HOST`, `DATABASE_PORT=5432`,
`DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `SEED_DEMO=0`.
Optional: `REMINDER_EMAIL_TO`, `BACKFILL_DAYS` (7; 0 = off), `BACKFILL_WAITING_HOURS` (24), `HEALTH_MINUTES`,
`DATABASE_POOL`, `CLICKUP_CURRENT_FOLDER(_ID)`, `NEXT_DIST_DIR` (test builds), `DISABLE_WORKER` (test server).

**Owner login:** `m.ahmad@getaichatbots.com`; password is still the `ADMIN_PASSWORD` value (owner was told to change it).

---

## 4. Code map

```
middleware.ts            auth gate; team role only reaches /portal + /api/portal
instrumentation.ts       starts the worker + ClickUp webhook re-register (skipped with DISABLE_WORKER=1)
next.config.mjs          distDir from NEXT_DIST_DIR (side-by-side test builds)
lib/db.ts                Postgres/SQLite driver, schema + migrations, kv, logEvent
lib/users.ts             logins (scrypt), clickup_name link for team members
lib/accounts.ts          mailboxes + WhatsApp numbers (AES secrets), updateAccount (edit in place)
lib/email.ts             IMAP poll, SMTP send (reply=false for fresh messages), testMailbox
lib/whatsapp.ts          gateway client: sendWhatsApp (ONE request, quote + mentions, no auto-resend), parseIncoming,
                         parseAck/isNewer/chatStatuses (ticks), senderPhone (@lid → phone), listChats, messagesSince
                         (history walk), listTargets (groups from chat list, contacts paged), groupMembers (5 s, cached),
                         resolveMentions ("@Name" → "@923…" + mentions), registerWebhook (+ack events; keeps n8n)
lib/inbound.ts           handleWhatsApp/storeWhatsApp (teammate = our reply, internal chats), applyDelivery/syncDelivery,
                         sendToConversation (double-send guard, quote last client msg, mentions), sendToTarget,
                         reminders (WhatsApp + email), worker
lib/backfill.ts          WhatsApp history import (batch insert, client groups only, name repair)
lib/team-numbers.ts      "our side" numbers (kv team_numbers; default Abdullah 13055083815)
lib/store.ts             conversations/messages/drafts; summaries (waiting, repliedBy, internal, context, remindAfter);
                         insertMessages (bulk)
lib/ai.ts                queue + chat(), clientMessage guard, polish, rewrite, suggestReply, generateReply,
                         summarizeConversation, summarizeTask, draftTicket (picks project/assignee), interpret, transcribe
lib/clickup.ts           board() (priority, dueAt, doneAt), taskDetail, createTask, statuses, setTaskStatus,
                         ensureClickupWebhook, clickupWebhookInfo, pushTimeEntry
lib/timers.ts            timers (master switch timers_on), status-driven syncStatusTimers, minutes, status_log
lib/estimates.ts         my estimate + strict Gemini estimate (single + batch estimateMissing)
components/Dropdown.tsx  app-styled dropdown (search for >8 options, opens up/down)
components/WaitingCard.tsx  waiting card + ReplyBox (voice, Generate/Stop, @mentions)
components/TaskControls.tsx StatusSelect, TimerButton, EstimateBox, clock, useTick
components/TeamNumbersManager.tsx  team numbers + "Import recent chats"
components/AccountsManager.tsx     add/edit/remove mailboxes and WhatsApp numbers
app/(app)/inbox          threads, channel filter, unread dots, header (Project / Remind after / Not a client / Handled),
                         linked tickets, context box (hideable), ticks, ReplyBox
app/(app)/team           people, tasks (sort, priority, status dropdown, estimates), project time, Current projects /
                         Team performance tabs, Timers on/off, Estimate open tasks, task panel (Get context, log)
app/(app)/page.tsx       Overview: waiting cards, team drafts, working now, status changes
app/(app)/settings       health, reminders, accounts, team numbers, groups, logins, ClickUp webhook
app/portal               team page: My tasks (timer buttons hidden while timers are off), send update (30/hour limit)
app/api/…                state, conversations/[id] (send, generate, context, internal, remind_after, …), drafts/[id],
                         tasks (+links), tasks/[id] (+status, estimate, context), timers, team, estimates, clickup,
                         team-numbers, whatsapp/backfill, whatsapp/targets, accounts, users, portal, ai, assistant,
                         webhooks/whatsapp, webhooks/clickup
```

---

## 5. What is DONE and TESTED

| Area | State |
|---|---|
| Logins | Owner + team (scrypt, Supabase). Team blocked from owner pages. Team login ↔ ClickUp member link. |
| WhatsApp in | Signed webhook (`message.received, message.sent, message.ack, message.failed`) next to n8n's. Test delivery 200. |
| History import | 7 days imported (~2,700 msgs; 35 direct chats + 12 client groups). Runs on start / reconnect / Settings button. Groups only if a team number is in them or already tracked. Old unanswered (>24 h) new chats marked handled. |
| Our side | Team numbers (Abdullah default). Their group messages = our reply ("Replied by Abdullah"); their DMs internal. "Not a client" toggle. Names instead of raw ids. |
| WhatsApp out | **One request per send, never auto-resent** (a timeout-retry once caused duplicates, fixed). Quotes the client's last message; only a clear 4xx quote rejection retries unquoted. Same text to same chat within 60 s / while sending is blocked. `@Name` → mention (contacts + team numbers, group members 5 s/cached). **Owner is testing real sends himself.** Gateway takes ~25 s to accept a *quoted* send (1 s for other calls). |
| Ticks | ✓ / ✓✓ / blue ✓✓ / red ! from ack events + 2-min sync. |
| Reply box | Voice → text, **Generate** (draft or instruction → message, ~7 s), **Stop** while generating, Polish, Acknowledge. Guard against Gemini app prompts. |
| AI context | Hideable per-conversation summary (all channels); ClickUp task "Get context" (+ Looms). |
| Assistant | Works through the tunnel (e.g. "Which projects are pending from the client?"). |
| ClickUp | Two-way status sync (dropdown → ClickUp; webhook logs ClickUp changes; signed; no echo). Priority + Sort. |
| Estimates | Private estimate + strict Gemini estimate (team builds with Claude: small fix 30–45 min, feature 1–3 h, big ≤ 8 h). ~120 open tasks estimated. |
| Team page | Full names, tracked/estimate, project time breakdown, Team performance bars, Timers switch. |
| Tickets | Inbox → selected messages → Gemini picks project/assignee from instructions → ClickUp; links shown in thread. |
| Reminders | Per-client "Remind after"; WhatsApp + email summaries ("client group", max 15). |
| Inbox UI | Bordered searchable dropdowns, open chat highlighted, unread dot, channel filter, one channel line. |
| Settings | Edit mailboxes (tests before saving) and WhatsApp numbers; team numbers; import; webhooks. |
| Pages | All pages + assets load locally and through the tunnel (checked after the route-cache fix). |

---

## 6. ⏸ TIMERS — BUILT, SWITCHED OFF, NEED THE OWNER'S APPROVAL

**Never switch timers on (or start one in a test) without the owner saying so.** He will first connect GAC Desk to the
team's own **tracking portal** (he will provide its APIs) so breaks pause the clock.

- Master switch kv `timers_on = "0"`. Team page → "Timers on/off"; `POST /api/timers {action:"enabled", on}`.
  While off every start is refused (owner buttons, portal, status sync) and Start buttons are hidden.
- Owner's rule (implemented, `syncStatusTimers`): ClickUp **in progress / revision** → running for the assignee; any other
  status → paused; complete/closed → stopped (task total final). Acts on status *changes* (kv `status_seen`); called by the
  ClickUp webhook, the status dropdown and the worker. Turning on clears `status_seen`.
- Free plan ⇒ only the token owner's time is copied to ClickUp ("GAC Desk timer").
- To do on approval: tracking-portal break/active state → pause/resume, then switch on.
- 2026-11-02 incident (23 auto timers + 3 ClickUp time entries) — **cleaned up** with the owner's OK.

---

## 7. Decisions waiting on the owner

1. **Reply-quote on WhatsApp sends:** quoted sends take ~25 s on the gateway. Keep quoting, or switch it off for instant sends?
2. **n8n bot replies** go out from the same number and count as "answered". Flag them so the client still shows waiting?
3. **Messaging the team** from GAC Desk — owner will explain later. Don't build yet.

---

## 8. Still to build

1. **Slack** (not started). Slack app **from a manifest** (prefilled `https://api.slack.com/apps?new_app=1&manifest_json=<urlencoded>`),
   **Socket Mode**, user scopes `channels:history groups:history im:history mpim:history channels:read groups:read im:read
   mpim:read users:read chat:write`, user events `message.channels message.groups message.im message.mpim`. Owner pastes
   **User OAuth Token (xoxp-)** + **App-Level Token (xapp-, connections:write)** → account kind `slack`. Worker:
   `apps.connections.open` → WebSocket → channel `slack`; send `chat.postMessage`; health `auth.test`.
2. Timers ↔ tracking portal (§6), when the owner gives the APIs.
3. Outlook / Teams — skipped for now.

---

## 9. Known issues / owner to-dos

- **Titan mailbox** login fails → Settings → Edit (right password / app access on).
- **Gmail** saved as `jimaesmith9871@gmail.com` (should be `jimmysmith9871@gmail.com`) and needs an **App Password** → Settings → Edit.
- Add Yusuf's number and the company number → Settings → team numbers.
- Rotate secrets that were pasted in chat: WhatsApp gateway API key (n8n snippet), Gemini API key (curl), owner password.
- Internal groups "Get-Ai Development Team" / "Get-Ai Dev Operations with HR" count as client groups (Abdullah is in them) → owner can mark "Not a client".
- The 4 duplicate messages already sent in "Get-Ai Team NOVA T" (before the fix) — owner can delete extras on the phone.
- Tunnel URL changes on restart → final fix is the VM + DuckDNS.

---

## 10. How to run / operate (lessons from this session)

- **Build first, restart second** (≈1 s downtime). Stopping the server first and then hitting a build error left it down
  and the owner saw errors. A failed `next build` can also disturb the running one, so check first:
  `NEXT_DIST_DIR=.next-test npx next build` (catches type errors `tsc --noEmit` misses), then `npm run build`, then restart.
- Side-by-side test server: `.claude/launch.json` "test-build" (port 3100, `NEXT_DIST_DIR=.next-test`, `DISABLE_WORKER=1`).
- Test with curl: `/api/auth/login` (cookie jar) → APIs. Browser checks: temporary admin login `zz-…@example.invalid`, delete after.
- DB checks: small node scripts that read `.env` and use `postgres` from the project (Supabase MCP `execute_sql` was declined for deletes).
- Never return 502 from APIs (Cloudflare hides the body).
- Never auto-retry anything that sends a message.

---

## 11. Next steps (in order)

1. §0 Start-up; give the owner the new tunnel URL.
2. Owner tests sends himself; check what was actually sent if he reports a problem (compare `messages` with the gateway's
   `GET /messages?chatId=…`).
3. Get the owner's answers to §7 (quote on/off, bot replies).
4. Build Slack (§8.1) → give the manifest link → owner pastes xoxp + xapp tokens → test receive + send (send only with OK).
5. Owner fixes Titan + Gmail (Settings → Edit) → test reading; send a test only with OK.
6. Tracking-portal APIs → timers (§6) → owner approves → switch on.
7. Ask before pushing to GitHub (everything after `aa5b107` is local); then deploy to the Google VM.
