# Cookie-Web

Header search uses the same hybrid ranking after a typing pause and on Enter.
Mail search includes archived messages by default; use `in:inbox`, `in:sent`,
or `in:done` to restrict folders. Deleted messages remain excluded. Quote a
term or phrase for exact keyword matching, using `mode=keyword` in a search
URL when you want keyword-only results.

Cookie is a private, AI-assisted email application. The Vue frontend and authenticated Vercel functions provide inbox browsing, search, labels, AI compose, mailbox Q&A, and outbound mail.

The production application is available at [mail.infinitywave.online](https://mail.infinitywave.online). System-wide architecture, component, data-model, AI, and operations guides live in [Cookie Documentation](https://allistera.github.io/Cookie-Docs/).

## Repository map

| Repository                                                  | Responsibility                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Cookie-Web                                                  | Vue browser client, Auth0-protected Vercel API, and shared database migrations         |
| [Cookie-Worker](https://github.com/allistera/Cookie-Worker) | Cloudflare Workers for inbound mail, scheduled enrichment, and scheduled-send flushing |
| [Cookie-iOS](https://github.com/allistera/Cookie-iOS)       | Native SwiftUI client of the Cookie-Web API                                            |
| [Cookie-Docs](https://github.com/allistera/Cookie-Docs)     | Blume/MDX documentation site for the whole system                                      |

## Architecture

```text
Cloudflare Email Routing
  -> Cookie-Worker
       -> parse MIME and upload attachments to Vercel Blob
       -> store through Hyperdrive in Supabase Postgres
       -> forward the original email
       -> run best-effort OpenAI classification
       -> index into Meilisearch

Vue 3 browser application
  -> Auth0-protected Cloudflare Workers (and `/api/send`, still on Vercel)
       -> Supabase Postgres
       -> Meilisearch Cloud
       -> OpenAI Responses API
       -> Resend
```

Cookie-Worker lives in the separate [Cookie-Worker repository](https://github.com/allistera/Cookie-Worker). Database migrations remain in this repository because both runtimes share the same schema.

## Features

- Inbox, Starred, Sent, Snoozed, Spam, Done, and label views.
- The inbox Important tab combines high-priority and due mail with mail assigned
  to a category named Important (ignoring case and surrounding spaces). Each email
  is counted once, and the command menu offers the same combined tab.
- Auth0 authentication and per-user mailbox queries.
- Debounced hybrid search over stored mail, served by Meilisearch, with filters such as
  `tag:Personal`, `sender:foo@bar.com`, `to:`, `has:attachment`, `before:`, and `after:`.
- Mailbox Q&A with retrieved email sources.
- AI Today: gathered to-dos (built-in Tasks due today or overdue plus action items
  extracted from important mail), Reply Needed/Review/Noise triage over the last 24 hours
  of Inbox mail, and a personalised news round-up. Reply Needed and Review are
  visible priority groups; Noise is summarized by category without archiving or
  deleting anything. The `data-enricher` Worker produces these records and
  Cookie-Web's browser SPA reads them directly from the `cookie-web-tasks`
  Cloudflare Worker (Cookie-Worker repo), not this app's own API.
- Settings → Personalisation edits the topics the news round-up is ranked
  against. Stored server-side in `users.prefs` rather than the browser, since
  the Worker reads them on its schedule with no browser open.
- Settings → AI Today edits the data-enricher model and its Europe/London
  schedule. It defaults to GPT-5 nano every day, hourly from 09:00 through
  19:00 inclusive; the hourly Cloudflare trigger skips AI work outside the
  stored slots.
- AI Compose with an explicit review-and-insert step; it never sends automatically.
- AI Document: the New document dialog's "AI document" option turns a prompt into
  a titled, block-formatted page (via `cookie-web-ai`'s `POST /document`).
- Per-label auto-tag controls and conservative spam classification.
- Settings → Rules starts with a plain-English description and **Generate Rule**.
  Review and edit the suggested name, matching details, action and tag, then select
  **Create Rule** to save it. Generation never activates a rule or changes mail.
  Cookie uses exact conditions when appropriate or an editable AI matching prompt
  for semantic requests. Existing rules remain editable. Supported actions are
  applying an existing user tag or marking mail done (archive and mark read).
  Unsupported requests explain the limitation; missing tags must be selected before
  saving. The authenticated `cookie-web-ai` `POST /rule-draft` endpoint shares the
  existing AI quota and compose model; deploy that Worker before the frontend.
- Outbound delivery through Resend with stored sent copies.
- Best-effort sent-mail read receipts using opaque tracking tokens.
- Supabase Realtime pings for inbox refreshes.
- Opt-in browser notifications for new mail while Cookie is open in a background tab.
- Optional ntfy.sh notifications for new mail when Cookie is not open. Enable it in Settings →
  Notifications, then subscribe to the generated private topic in the ntfy iOS app.
- Settings → Email → Auto Archive offers independent, initially disabled categories
  for marketing, cold pitches and social noise. High-confidence, low-priority matches
  arriving after activation move to Done and are marked read, never deleted. Read,
  starred and scheduled messages are left alone. AI filing is asynchronous and can
  make mistakes; archived messages remain available in Done.
- Mute or unmute a conversation from the reader's notification button. Muted
  replies still arrive and update the inbox, but do not raise browser notifications;
  muting persists across sessions and clears queued alerts for that thread.

See [AI capabilities: decision and implementation](docs/AI-CAPABILITIES-REPORT.md) for the detailed AI design and [Cookie Documentation](https://allistera.github.io/Cookie-Docs/) for the deployed system guide.

## Technology

| Area            | Technology                                        |
| --------------- | ------------------------------------------------- |
| UI              | Vue 3, Pinia, Vue Router, Vite                    |
| Hosting and API | Vercel (static + `/api/send`), Cloudflare Workers |
| Authentication  | Auth0                                             |
| Database        | Supabase Postgres                                 |
| Realtime        | Supabase Realtime broadcast                       |
| Search          | Meilisearch Cloud (hybrid)                        |
| AI              | OpenAI Responses API                              |
| Outbound email  | Resend                                            |

## Local development

Requirements:

- Node.js `^22.18.0` or `>=24.12.0`.
- npm.
- Playwright browsers for end-to-end tests.

Install dependencies and start Vite:

```sh
npm install
npm run dev
```

Without `DATABASE_URL`, the local API middleware uses fixture data. Add the required values to `.env.local` only when testing authenticated APIs against a development database.

Never commit `.env.local` or use the production database for routine local development.

## Configuration

The main runtime variables are:

| Name                     | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `DATABASE_URL`           | Supabase Postgres connection used by migrations and local development tooling. |
| `OPENAI_API_KEY`         | Mailbox Q&A and AI Compose. Needs the `/v1/responses` scope only.              |
| `OPENAI_COMPOSE_MODEL`   | Optional AI Compose model override.                                            |
| `VITE_AUTH0_DOMAIN`      | Auth0 tenant domain exposed to the browser.                                    |
| `VITE_AUTH0_CLIENT_ID`   | Auth0 SPA client ID exposed to the browser.                                    |
| `VITE_AUTH0_AUDIENCE`    | Auth0 API audience exposed to the browser.                                     |
| `VITE_SUPABASE_URL`      | Supabase project URL used for Realtime.                                        |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key used for content-free Realtime pings.                 |

`ENRICHER_RUN_URL` and `ENRICHER_TRIGGER_TOKEN` used to live here (read by this app's own `/api/tasks`). That handler and its `_lib` dependents were removed once the browser SPA started calling the `cookie-web-tasks` Cloudflare Worker directly instead — those two now belong to that Worker's own Cloudflare config (Cookie-Worker repo), not Vercel's.

The `/api/send` compatibility adapter now forwards to `cookie-web-send`. Attachment upload authorization and registration remain on Vercel and retain their Blob storage, database, and authentication settings. Set delivery credentials and the flush token on that Worker; deploy its follow-up support before deploying this adapter. Web request IDs survive failed sends and are renewed after successful delivery. Migration `0065_task_subtree_projects.sql` repairs task descendants left in old projects and adds a parent lookup index.

Vercel stores browser build values. GitHub Actions stores only the secrets its migration workflow needs.

### Auth0 user provisioning

API authorization binds the token's verified Auth0 issuer and immutable `sub`
to `users.auth0_sub`; token email claims never select a mailbox. When moving a
user between Auth0 connections, verify ownership in Auth0 and explicitly update
that user's `auth0_sub` before switching the login. Reusing the email address is
not sufficient account linking.

## Database migrations

Migrations are append-only and live in [`migrations/`](migrations/). Apply all pending files with:

```sh
export DATABASE_URL='postgres://...'
./migrations/migrate.sh
```

The `Migrate Database` workflow runs automatically when migration files reach `main`. See [migrations/README.md](migrations/README.md) for conventions and AI schema details.

## Validation

```sh
npm run lint
npm run test:unit -- --run
npm run build
npm run test:e2e
```

Install Playwright browsers once if required:

```sh
npx playwright install
```

Run a narrower browser test with `--project=chromium` or a specific file path when iterating locally.

## Delivery and operations

Pushes to `main` run CI and trigger the linked Vercel production deployment. Migration changes also trigger the database migration workflow.

Search reindexing and drift repair run from the Cookie-Worker repository (`search-reindex.yml` and `search-drift-repair.yml`). Cloudflare Worker deployment and email-routing operations are documented in the Cookie-Worker runbook.

### Recurring tasks

Use **Repeat** in Add Task or the task detail panel. Supported schedules include
`every Monday`, `every 2nd Tuesday` (the second Tuesday of each month),
`every last Friday`, `every 3 days`, and `every 2 weeks`. `daily` and `weekly`
are also accepted. Day/week intervals accept 1–365; monthly ordinal weekdays
accept `1st` through `5th` and `last`. A fifth weekday skips months without one.

The first occurrence is on or after the task's due date, or today in the
browser's local calendar if no date is set. Intervals start on that date.
Completing a recurring task keeps the same task open and advances its due date
to the next occurrence after both its current due date and the local completion
date. Overdue intervals retain their original cadence and skip missed dates.
Future occurrences leave Today but remain in their project. Subtask completion
states are preserved. This does not create separate tasks or a completion history.

Clear Repeat and save to stop repetition while keeping the current date;
clearing the due date also stops repetition. Unsupported phrases are rejected.
Repeat remains a separate field in the inline task editor and detail panel.
The sidebar's Add Task dialog can also parse it from natural-language quick add.

Apply `migrations/0066_task_items_recurrence.sql` before deploying the updated
`cookie-web-tasks` Worker, then deploy the web client. No background job or new
dependency is needed.

### Natural-language task quick add

The sidebar's **Add Task** button opens a natural-language textbox. A request
such as `Call plumber Friday 3pm p1 #Work @home` resolves the task title, local
due date and time, priority, existing project, and labels in one submit.
`p1`–`p4`, `#Project`, and `@label` are parsed exactly before the remaining
text is sent to the AI interpreter. Project matching is case-insensitive and
never creates a project; an unknown or duplicate project name is returned for
correction.

Choose **Advanced** to parse the text without creating the task, then review or
edit the full form. A request containing only scheduling metadata opens this
form and asks for a task name while keeping the parsed fields. Due times are
stored with the browser's IANA time zone, so the original local time remains
explicit.

Apply `migrations/0067_task_items_time_and_labels.sql` before deploying the
updated `cookie-web-tasks` Worker, then deploy the web client. The Worker uses
the existing `OPENAI_API_KEY` and rate-limits interpretation to 10 requests per
user per minute.

### Automatic priority replies

When Cookie classifies an incoming email as high priority, it prepares a reply
using the existing AI key and saves it in Drafts. Open the email to see the
editable **AI draft** beneath the conversation, with **Send** and **Discard**.
Only clicking Send sends the reply. Edits are saved when switching emails and
can be resumed after reloading.

The reply toolbar also includes an **AI** button for any email. Click it to
generate a response directly in the message body, using the email and any
existing reply text as context. The button shows progress while generating;
failures preserve your text, and a late response cannot replace edits made
while waiting or fill a different reply. Generated text stays editable and
autosaves through the normal draft flow. Click **Send** when ready.

Existing drafts, answered threads, scheduled replies, archived/deleted mail,
spam, and no-reply senders are skipped. Discarding or sending a generated draft
does not cause it to be recreated. The background recovery job also picks up
unanswered priority mail from the last 30 days, three emails every 15 minutes,
with at most three generation attempts per email.

Apply `migrations/0069_priority_reply_drafts.sql` before deploying Cookie-Worker's
`mail-app-ingest` and `cookie-web-drafts`. Initial draft creation emits the
existing content-free inbox refresh signal, allowing an open reader to show
the draft as soon as it becomes available.

### AI Task

In Tasks, select **AI Task** below **Add Task**. Describe an idea such as
“Plan day trip to London” and press Enter or the submit arrow. Cookie generates
a title, description, and useful subtasks, saves them in Inbox, and opens the
new task. The centered prompt blurs the background, supports Escape to close,
and keeps your text if generation fails. The Tasks Worker must provide
`POST /task-items/generate`; it uses the existing server-side AI credentials.

GitHub news shows all repositories returned by the daily top-repository feed by default. Enable **Settings → Personalisation → Personalise GitHub repositories** to rank and select repositories against your interests on the next AI Today refresh; Product Hunt continues to use your interests independently.

### Files and the folder browser

The Documents dashboard shows one folder at a time: subfolders first, then documents and uploaded files by name, as cards or rows (toggle in the toolbar; the choice is remembered in this browser). Click a folder in the sidebar or double-click its card to open it; the breadcrumb goes back up. The sidebar tree follows along, opening the current folder (or the folder holding the open document) and its parents. **Upload** or drop files onto the pane to add any file type up to 25 MB to the current folder. Images and PDFs open in an inline preview; other types download. Each item's menu offers open, rename, move, star (documents), download (files), and delete. Files live in a private R2 bucket behind the `cookie-web-tasks` Worker and are not searched, tagged, or read by Document AI. The Starred, tag, and search views keep the flat table.

### Document icons

Open a document and click its icon to the left of the title to choose an emoji. Icons autosave with other edits and appear in the sidebar and document list. If saving fails, the selection stays open for **Retry save** or **Save a copy**.

The AI button beside the document back arrow opens a panel on the right. Close it with the close button or Escape; the chat layout shows the document context, a scrollable conversation area, and a message composer. Drafts stay while the panel is closed and reset when switching documents. Send an instruction to GPT-5.6 Sol with the latest document snapshot and recent conversation. Review the response and use **Apply changes** to update the document, or **Create document** when starting from the dashboard. Newer local edits prevent stale suggestions from being applied; images, drawings and other non-text blocks are preserved. Failed requests keep the draft message for retry.

Document AI uses the authenticated `/document-chat` route on `cookie-web-ai`; the OpenAI key stays in the Worker. Enter sends, Shift+Enter inserts a newline, and switching documents cancels the pending response and clears the conversation. Full document context is limited to 500 blocks / 250,000 characters; oversized requests show an error rather than sending a truncated draft.

## Document tables and review fixes

New plain tables use a lightweight cell editor with Add row and Add column controls. Choose **Open spreadsheet** for formulas and advanced spreadsheet tools. Existing formula tables and workbook snapshots keep the full spreadsheet editor, with offscreen activation deferred until needed. Plain-table edits keep the existing content-grid storage/export format.

Document blocks become interactive only after Editor.js has installed its change observer. Task deep links wait for their detail lookup; temporary failures remain retryable. AI document creation completes its save without replacing a document opened while the request was pending.
