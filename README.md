# GAC Desk

> **For Claude:** This is the project brief. Read it fully, then help with whatever I ask.

A private dashboard for the owner: every client message in one inbox, AI-drafted replies, reminders until each client gets an answer, and the team's ClickUp work at a glance.

## Status (working)
| Area | State |
|---|---|
| Login | Single owner account from `.env`, signed session cookie |
| WhatsApp | ChatSlash/OpenWA gateway: receive (signed webhook), send, your phone replies recorded, voice notes downloaded |
| Gemini | Custom web-to-API server (`gemini-4-argon`): suggested replies, polish, ticket drafts, voice-command assistant |
| ClickUp | Live: tracks **Current Projects** folder (list = project, list status = owner), creates tasks there, reads comments/attachments for Looms, knows every project's stage |
| Assistant (`/` key) | Chat with voice (English/Urdu/Hindi): reply to clients, create tasks, search ClickUp / email / chats |
| Reminders | Popup every N min with suggested replies, instant new-message alert, desktop notification, WhatsApp summary to the owner's phone |
| Email | IMAP/SMTP code ready (Titan/Zoho password, Gmail app password). Needs credentials |
| Speech to text | Whisper (Groq/OpenAI-compatible). Needs `WHISPER_API_KEY`. Browser speech is used until then |
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
Open http://localhost:3000 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. Data lives in `data/local.db` (SQLite, built into Node 22.13+).

## Configuration
All keys are in `.env` (see `.env.example`). Never commit `.env`.

## Deploy (Google Cloud e2-micro, 1 GB, free)
1. Create the VM (Ubuntu 24.04, allow HTTP + HTTPS), point a domain (e.g. DuckDNS) at its IP.
2. On the VM: `bash setup.sh <repo-url> <domain>`, fill `.env`, run it again.
3. In the dashboard: Settings → **Register webhook on the gateway**.
Updates: `bash /opt/gac-desk/deploy/update.sh`.

## Tech
Next.js 15 (app + API in one process), Tailwind 4, SQLite (`node:sqlite`), imapflow/nodemailer, background worker in `instrumentation.ts`. ~200 MB RAM at runtime.
