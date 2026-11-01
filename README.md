# GAC Desk

> **For Claude:** This is the project brief. Read it fully, then help with whatever I ask.

A private dashboard for the owner: every client message in one inbox, AI-drafted replies, reminders until each client gets an answer, and the team's ClickUp work at a glance.

## Status (working)
| Area | State |
|---|---|
| Login | Single owner account from `.env`, signed session cookie |
| Database | **Supabase Postgres** (session pooler, port 5432), row-level security on every table so the public API sees nothing. Falls back to local SQLite when `DATABASE_*` is empty. `scripts/sqlite-to-postgres.mjs` copies a local DB up |
| Accounts | Mailboxes and WhatsApp numbers added in Settings (any number of them), passwords AES-256-GCM encrypted. Every reply has a From picker |
| WhatsApp | ChatSlash/OpenWA gateway: receive (signed webhook), send, your phone replies recorded, voice notes downloaded |
| Gemini | Custom web-to-API server (`gemini-4-argon`): suggested replies, polish, ticket drafts, voice-command assistant |
| ClickUp | Live: tracks **Current Projects** folder (list = project, list status = owner), creates tasks there, reads comments/attachments for Looms, knows every project's stage |
| Assistant (`/` key) | Chat with voice (English/Urdu/Hindi): reply to clients, create tasks, search ClickUp / email / chats |
| Reminders | Popup every N min with suggested replies, instant new-message alert, desktop notification, WhatsApp summary to the owner's phone |
| Email | Every mailbox polled each minute over IMAP, replies over SMTP from the chosen mailbox. Titan/Zoho: password; Gmail: App Password |
| Speech to text | Free open-source Whisper running inside the server (Transformers.js + bundled ffmpeg), English/Urdu/Hindi detection, English translation for Urdu/Hindi. Optional Whisper API |
| Slack, Teams, Outlook | Not yet. Slack needs a Slack app; Teams/Outlook need an Azure app (Sign in with Microsoft) |
| Time log from status changes | Webhook endpoint stores ClickUp events; reporting not built yet |

## Pages
Overview (who's waiting + drafted replies, team drafts, who's working) · Inbox (threads, voice notes, suggestions, create task) · Team (people, current projects, task panel with comments and Looms) · Settings (connections, webhook registration, reminder timing, team links, clear test data).
Team members write client updates at `/team-reply/<token>`; nothing reaches a client until the owner approves.

## Run locally
```bash
npm install
npm run build
npm run start
```
Open http://localhost:3000 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. Data lives in Supabase (or `data/local.db` without `DATABASE_*`). Voice notes and the Whisper model are kept in `data/`.

## Configuration
All keys are in `.env` (see `.env.example`). Never commit `.env`.

## Deploy (Google Cloud e2-micro, 1 GB, free)
1. Create the VM (Ubuntu 24.04, allow HTTP + HTTPS), point a domain (e.g. DuckDNS) at its IP.
2. On the VM: `bash setup.sh <repo-url> <domain>`, fill `.env`, run it again.
3. In the dashboard: Settings → **Register webhook on the gateway**.
Updates: `bash /opt/gac-desk/deploy/update.sh`.

## Tech
Next.js 15 (app + API in one process), Tailwind 4, Supabase Postgres via postgres.js (SQLite fallback), imapflow/nodemailer, local Whisper, background worker in `instrumentation.ts`. ~200 MB RAM at runtime plus ~300 MB while Whisper is loaded (unloads when idle).
