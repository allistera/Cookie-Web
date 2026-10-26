# Cookie-Web

Header search uses the same hybrid ranking after a typing pause and on Enter.
Mail search includes archived messages by default; use `in:inbox`, `in:sent`,
or `in:done` to restrict folders. Deleted messages remain excluded. Quote a
term or phrase for exact keyword matching, using `mode=keyword` in a search
URL when you want keyword-only results.

Cookie is a private, AI-assisted email application. The Vue frontend, served from Vercel, and Auth0-protected Cloudflare Workers provide inbox browsing, search, labels, AI compose, mailbox Q&A, and outbound mail. Vercel runs only two residual functions, `api/health.js` and `api/send.js`.

The production application is available at [mail.infinitywave.online](https://mail.infinitywave.online). System-wide architecture, component, data-model, AI, and operations guides live in [Cookie Documentation](https://allistera.github.io/Cookie-Docs/).

## Repository map

| Repository                                                  | Responsibility                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Cookie-Web                                                  | Vue browser client, two residual Vercel functions, and shared database migrations      |
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

Vue 3 browser application (static build served from Vercel)
  -> Auth0-protected Cloudflare Workers (and `/api/send`, still on Vercel)
       -> Supabase Postgres
       -> Meilisearch (self-hosted)
       -> OpenAI Responses API
       -> Resend
  <- Supabase Realtime: content-free "inbox changed" pings on a private channel
```

Cookie-Worker lives in the separate [Cookie-Worker repository](https://github.com/allistera/Cookie-Worker). Database migrations remain in this repository because both runtimes share the same schema.

## Features

- Settings → Calendars → **Private calendar feeds** generates a read-only
  subscription URL for each native Cookie calendar. Copy it into another app's
  calendar-subscription field. Links are shown only when generated; replacing
  a link invalidates the previous one, and revoking it stops further downloads.
  Anyone holding a link can read that calendar's full event details. Imported
  and Google calendars are excluded. Refresh timing belongs to the subscriber;
  previously downloaded events may remain after revocation. Native event times
  retain Cookie's floating local-time behaviour.

- Inbox, Starred, Sent, Snoozed, Spam, Done, and label views.
- The inbox Important tab combines high-priority and due mail with mail assigned
  to a category named Important (ignoring case and surrounding spaces). Each email
  is counted once, and the command menu offers the same combined tab. Inbox tabs
  appear only when they contain loaded emails; when the selected tab becomes
  empty, the first populated tab opens automatically.
- The Mail inbox tabs show a compact chip for today's next timed calendar event,
  including its start time, title, and live countdown. Clicking the chip opens
  Calendar on that date with the event details showing. It is hidden when no
  upcoming timed event remains; all-day events are excluded. Events refresh
  every five minutes while visible and when returning to the tab.
- When an open email describes an event (or carries a calendar invite), the
  reader offers to add it to Calendar with the details prefilled. Once that
  entry exists, the reader shows "Already on your calendar" with a "Go to
  event" button that opens it in Calendar instead of offering it again. An
  entry counts when Calendar created it from that email (remembered in this
  browser, so it still matches after being renamed or moved) or when an event
  on the same day has the same start time and title, such as an invite Google
  Calendar added by itself.
- Settings → Calendars → Add subscription accepts public `https://` and
  `webcal://` calendar feeds from supported providers, including Apple iCloud.
  Enable Public Calendar sharing in iCloud and paste its link here. Webcal links
  are fetched over HTTPS; subscribed events are read-only and can be refreshed
  with Sync.
- Settings → Calendars → Google Calendar signs the account into Google and lists
  the Google calendars it can see; tick the ones to show in Cookie. Their events
  appear in the Calendar view (and the Mail next-event chip and daily-note
  sidebar) in their own sidebar section, and can be opened, edited, moved
  between the account's writable Google calendars, created and deleted from the
  event dialog like Cookie's own. Google-side details Cookie does not model
  (repeat rules, attendees) stay in Google Calendar; a repeating event is edited
  one occurrence at a time, and each dialog links to the event in Google
  Calendar. Calendars the account can only read open read-only. The
  `cookie-web-calendar` Worker holds the tokens and talks to Google; the browser
  never does. Linking finishes only in the tab that started it and under the
  same signed-in Cookie account. Apply `migrations/0091_google_calendar.sql`
  and `migrations/0102_google_calendar_browser_binding.sql` and set that Worker's
  Google secrets (Cookie-Worker README, "Google Calendar") before deploying.
- Auth0 authentication and per-user mailbox queries.
- The email list opens its first available date group by default, including
  Yesterday when there is no mail from Today. Due Today and Today also default
  to open. Click a group header to expand or collapse it.
- Press `?` (or pick Keyboard Shortcuts in the `/` command palette) for a list of
  every keyboard shortcut.
- The bucket collects emails, documents, tasks and calendar events for a piece
  of work in hand. Press `b` on an open email, document, task or event (or pick
  Pin to Bucket in the `/` palette) to pin it; the first pin makes the bucket and
  its button at the top right of the header. The button opens a panel listing
  the pinned items, each of which opens where it lives (an email goes back to
  the folder it was pinned from, so it must still be listed there); typing on
  the panel's title names the bucket and clicking its icon changes it. Pressing `b` on an
  item already in the bucket takes it out again, as does the item's remove
  button. The bucket is temporary: it clears itself three days after it is
  made, which the panel's "Clears in" control restarts at one day, three days
  or a week; Done removes it and everything in it at once (with Undo, which
  keeps anything pinned in the meantime). The panel's close button, Escape or
  a click outside close it with the bucket kept. There is one bucket per
  account, kept in this browser's localStorage, so it does not follow the
  account to other devices. The event dialog also has a pin button, since a
  plain `b` there types into the title.
- Manage sender acceptance and blocking in Settings → Senders. In New senders,
  select one held email and choose **Restore this message only** to release it
  without accepting its sender. With screening enabled, future mail stays held.
  Accept and Block apply
  to the sender's domain (or exact address for public email providers). Accepting
  marks the approved email read, so it reaches the inbox as mail already seen.
- Debounced hybrid search over stored mail, served by Meilisearch, with filters such as
  `tag:Personal`, `sender:foo@bar.com`, `to:`, `has:attachment`, `before:`, and `after:`.
- Mailbox Q&A with retrieved email sources.
- AI Today: gathered to-dos (built-in Tasks due today or overdue plus action items
  extracted from important mail), Reply Needed/Review/Noise triage over the last 24 hours
  of Inbox mail excluding Done emails, and a personalised news round-up.
  Reply Needed and Review are visible priority groups. Mark all emails as Done
  completes every email in a group, including read emails. Done rows disappear immediately;
  Noise is summarized by category without archiving or
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
- Optional ntfy.sh notifications for new mail when Cookie is not open. Turn the switch on in
  Settings → Notifications, then subscribe to the generated private topic in the ntfy iOS app.
  Turning the switch off pauses alerts and keeps the topic, so turning it back on needs no
  resubscribing.
- Settings → Email → Auto Archive offers independent, initially disabled categories
  for marketing, cold pitches and social noise. High-confidence, low-priority matches
  arriving after activation move to Done and are marked read, never deleted. Read,
  starred and scheduled messages are left alone. AI filing is asynchronous and can
  make mistakes; archived messages remain available in Done.
- Mute or unmute a conversation from the reader's notification button. Muted
  replies still arrive and update the inbox, but do not raise browser notifications;
  muting persists across sessions and clears queued alerts for that thread.

See [AI capabilities: decision and implementation](docs/AI-CAPABILITIES-REPORT.md) for the detailed AI design and [Cookie Documentation](https://allistera.github.io/Cookie-Docs/) for the deployed system guide.

## Offline use

Cookie keeps working, read-mostly, without a connection. The service worker
(`public/sw.js`) serves the app shell, its fonts and icons, and the last
twenty opened message bodies. On top of that the stores keep the last
response the Workers served for the inbox and each folder's first page,
labels and categories, the task list per project, the project list, the
documents workspace and the last twenty opened documents, all in an
IndexedDB database keyed by the signed-in account (`src/lib/offlineCache.js`).
A load that fails at the network layer shows that saved copy and a banner
saying so; HTTP errors still report as before.

Changes that cannot be sent wait in a persistent outbox
(`src/lib/outbox.js`): message flags (star, read, done, snooze), task edits
and completions, and document edits (shown as "Saved on this device" in the
editor). They stay on screen, survive a reload, and go out in order when the
browser reports being online again, when the tab becomes visible, and at the
next start. Later changes to the same item merge into the earlier queued one.
Temporary server refusals (including 429 and 5xx) and expired sessions retain
the change for a later sync. Permanent refusals stay in the sync banner with
explicit Retry and Discard actions; no failed request silently deletes an edit. A
document that changed elsewhere while you were offline has your edits saved
beside it as "<title> (offline copy)". Sending mail, search and AI features
need a connection and the Send buttons wait for one.

Composer and inline reply edits also keep account-scoped recovery copies in
IndexedDB before remote autosave. Drafts lists local copies after a failed save
or a conflict; opening one creates a separate draft so it cannot overwrite
another tab's newer version. The composer distinguishes server saves, local
saves, and unavailable storage. Unconfirmed delivery identities stay with the
local copy until sending is confirmed, so retrying after reload reuses the same
request. If local storage is unavailable, keep the tab open until remote saving
succeeds.

Signing out deletes the offline cache, outbox, and local draft recovery copies;
unsynced drafts trigger a warning before this deletion. Chromium and Firefox run
`e2e/offline.spec.js`, which cuts the Workers off and checks the cached
inbox, a queued star and its replay.

## Technology

| Area            | Technology                                        |
| --------------- | ------------------------------------------------- |
| UI              | Vue 3, Pinia, Vue Router, Vite                    |
| Hosting and API | Vercel (static + `/api/send`), Cloudflare Workers |
| Authentication  | Auth0                                             |
| Database        | Supabase Postgres                                 |
| Realtime        | Supabase Realtime broadcast                       |
| Search          | Meilisearch, self-hosted (hybrid)                 |
| AI              | OpenAI Responses API                              |
| Outbound email  | Resend                                            |

## Local development

Requirements:

- Node.js `^22.22.2` or `^24.15.0`.
- npm.
- Playwright browsers for end-to-end tests.

Install dependencies and start Vite:

```sh
npm install
npm run dev
```

Without `DATABASE_URL`, the local API middleware uses fixture data. Add the required values to `.env.local` only when testing authenticated APIs against a development database.

Never commit `.env.local` or use the production database for routine local development.

## Health monitoring

`GET /api/health` is a public readiness endpoint; `HEAD` returns the same status
without a body. It returns `200` with `status: "ok"` when all checks pass, or
`503` with `status: "degraded"` and an error status for each failed dependency.
Responses use `Cache-Control: no-store` and contain only component statuses.

Checks run in parallel with a three-second deadline each: a read-only Postgres
`SELECT 1`, Meilisearch `/health`, and the `/health` routes on the eleven
`cookie-web-*` API Workers and `cookie-mcp`. Worker probes check HTTP liveness;
they do not authenticate users, send mail, call AI providers, or verify scheduled
jobs. External provider credentials, schema migrations, and worker-specific
Hyperdrive connections are not validated by these probes.

Deploy the updated API Workers and `cookie-mcp` before this web release. Older
Workers without `/health` cause readiness to return `503`. Configure
`DATABASE_URL` in Vercel for the database check; no new secret is needed.
The same endpoint runs in Vite dev/preview using real checks, so missing local
configuration is reported as unhealthy rather than hidden by fixture data.
Use a development database for local monitoring.

```sh
curl -i https://mail.infinitywave.online/api/health
```

## Configuration

The main runtime variables are:

| Name                     | Purpose                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Supabase Postgres connection used by health checks, uploads, migrations, and local tooling. |
| `OPENAI_API_KEY`         | Mailbox Q&A and AI Compose. Needs the `/v1/responses` scope only.                           |
| `OPENAI_COMPOSE_MODEL`   | Optional AI Compose model override.                                                         |
| `VITE_AUTH0_DOMAIN`      | Auth0 domain exposed to the browser: `auth.infinitywave.online` in production.              |
| `VITE_AUTH0_CLIENT_ID`   | Auth0 SPA client ID exposed to the browser.                                                 |
| `VITE_AUTH0_AUDIENCE`    | Auth0 API audience exposed to the browser.                                                  |
| `VITE_SUPABASE_URL`      | Supabase project URL used for Realtime.                                                     |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key used for content-free Realtime pings.                              |

`ENRICHER_RUN_URL` and `ENRICHER_TRIGGER_TOKEN` used to live here (read by this app's own `/api/tasks`). That handler and its `_lib` dependents were removed once the browser SPA started calling the `cookie-web-tasks` Cloudflare Worker directly instead — those two now belong to that Worker's own Cloudflare config (Cookie-Worker repo), not Vercel's.

The `/api/send` compatibility adapter now forwards to `cookie-web-send`. Attachment upload authorization and registration remain on Vercel and retain their Blob storage, database, and authentication settings. Set delivery credentials and the flush token on that Worker; deploy its follow-up support before deploying this adapter. Web request IDs survive failed sends and are renewed after successful delivery. Migration `0065_task_subtree_projects.sql` repairs task descendants left in old projects and adds a parent lookup index.

Vercel stores browser build values. GitHub Actions stores only the secrets its migration workflow needs.

### Browser monitoring and Vercel configuration

The page Content Security Policy permits the Vercel Toolbar's documented script,
connection, frame, style, and font origins, including its Pusher WebSocket. This
supports the toolbar when Vercel injects it in production or preview deployments.
See [Vercel's toolbar CSP requirements](https://vercel.com/docs/vercel-toolbar/managing-toolbar#content-security-policy).

The browser uses [`@sentry/vue`](https://docs.sentry.io/platforms/javascript/guides/vue/)
for errors, page-load/navigation performance, request timings, Web Vitals, and
browser CPU profiles where the JavaScript Self-Profiling API is supported.
Vercel's Sentry integration variables are read at **build time**; redeploy after
changing them. Only the public DSN, environment, and release are embedded in the
browser bundle.

| Variable                       | Use                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                   | Enables browser reporting in production builds.                                              |
| `VERCEL_ENV`                   | Environment label (`production` or `preview`); defaults to `production` outside Vercel.      |
| `VERCEL_GIT_COMMIT_SHA`        | Release identifier shared by events and source-map uploads.                                  |
| `SENTRY_AUTH_TOKEN`            | Build-only credential for source-map upload. Never expose through `VITE_`.                   |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Source-map upload destination.                                                               |
| `SENTRY_PUBLIC_KEY`            | Not needed separately; the browser DSN already contains its public key.                      |
| `SENTRY_OTLP_TRACES_URL`       | Server-side OpenTelemetry endpoint; not used by this browser SDK.                            |
| `SENTRY_VERCEL_LOG_DRAIN_URL`  | Used by Vercel log-drain configuration, not the browser; this PR does not provision a drain. |

Existing `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, and `VITE_SENTRY_RELEASE`
overrides remain supported. `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE` also take
precedence over Vercel's environment/commit defaults. An explicitly empty
`VITE_SENTRY_DSN` disables monitoring even if `SENTRY_DSN` is present.

Browser tracing samples 10% of traces and uses Vue router names for navigation.
It records numeric Web Vitals and timing data, with URLs, query strings,
DOM selectors/text, arbitrary span attributes, and span links removed before
sending. Only the app's known route names and standard operation names survive.
Browser profiling is enabled for every session and runs only while one of
the sampled traces is active (`profileLifecycle: 'trace'`), so the trace rate
bounds profile volume. Vercel sends `Document-Policy: js-profiling` on app
document responses. Supported browsers can then collect execution-stack
samples; browsers without the profiling API still report errors and traces.
Profiles include code locations and function names, not mailbox values; they
are separate from the error/span filtering described here.
The SDK posts envelopes to the same-origin `/monitoring` path (`tunnel`), which
`vercel.json` rewrites to the project's Sentry envelope endpoint. Browsers with
ad or privacy blockers cancel direct requests to `*.ingest.sentry.io`, so
without the tunnel their errors, traces, and profiles never arrive. Update the
rewrite destination if the Sentry organisation or project changes.
Request tracing headers are not propagated to APIs. This covers browser
performance, not backend tracing or custom business metrics. Session replay
and application log collection remain disabled.

The SDK loads in the background without delaying app mount or service-worker
registration. A temporary Vue handler buffers up to 20 errors until it is ready;
existing error handlers still run. Browser errors outside Vue during this
loading window are not captured, and early request spans can be missed.
Development and E2E runs skip initialization even when a DSN is present.
SDK loading or initialization failures do not prevent mounting.

Error events exclude user identity, request metadata, breadcrumbs, Vue props,
free-form messages, and arbitrary diagnostic context. They retain standard
error types and same-origin `/assets/*.js` stack locations without query strings
or fragments, plus validated source-map debug IDs and configured release metadata.
This trades error-message detail for mailbox privacy. Performance spans have
separate filtering because Sentry v11 streams them independently of errors.

When the DSN, auth token, organization, and project are all present for a build,
the Sentry Vite plugin creates hidden source maps, uploads them, and deletes
`dist/**/*.map` before deployment. Shared modules already needed at startup are
bundled together to avoid paying Sentry's debug-ID bootstrap overhead in many
small chunks; the existing entry and feature size budgets remain unchanged.
The build uses native module preloads without the legacy preload polyfill;
browsers without module-preload support still load ES modules normally, but
without that preload optimization. Missing credentials leave source maps off;
invalid credentials cause the upload/build to fail so an unsuccessful upload is
visible. Fix any **Needs Attention** token status in the Vercel integration
before deploying with uploads enabled. No token is needed for browser reporting.

The CSP allows Sentry's default, US, and EU ingestion domains. A self-hosted or
custom ingestion domain must also be added to `connect-src` in `vercel.json`.
After deploying, trigger a temporary asynchronous uncaught error and check the
Sentry project's Issues view for `service: cookie-web` and the expected release.
Browse several routes and check performance traces/Web Vitals and the Profiling
view in a supported browser; sampling means
not every visit appears. Source-map upload and live ingestion require valid
Sentry configuration and cannot be verified by the credential-free CI build.

If profiling is empty, check the browser's Sentry envelope requests. Browser
profiling requires a supported Chromium browser and the `Document-Policy:
js-profiling` response header. Both trace and profiling session sampling apply.
Profile chunks are uploaded separately; the span privacy filter preserves only
validated profiler/profile IDs and fixed thread metadata to link them to traces.
A `429` with `profile_duration_ui_usage_exceeded` indicates an organization
profiling quota limit in Sentry; changing the DSN or enabling profiling again
does not resolve that quota. Review Sentry usage and limits before changing them.

### Auth0 user provisioning

API authorization binds the token's verified Auth0 issuer and immutable `sub`
to `users.auth0_sub`; token email claims never select a mailbox. When moving a
user between Auth0 connections, verify ownership in Auth0 and explicitly update
that user's `auth0_sub` before switching the login. Reusing the email address is
not sufficient account linking.

### Live inbox sign-in

The live inbox joins a private Supabase Realtime channel with the user's Auth0
ID token. Supabase accepts that token only when both of these are in place:

- Supabase has Auth0 added as a third-party auth provider for the tenant, under
  Authentication, Sign In / Providers, Third-Party Auth.
- An Auth0 Post Login Action sets the ID token claim `role` to `authenticated`
  with `api.idToken.setCustomClaim('role', 'authenticated')`, and is bound to the
  post-login trigger. Auth0 strips that claim from access tokens.

Until both are in place the channel stays unjoined, and the inbox refreshes every
three minutes instead. After changing the Action, sign out and back in, because a
session keeps the ID token it was issued with. If the channel still does not join,
compare the token's `iss` with the issuer Supabase trusts. Production uses the
custom domain `auth.infinitywave.online`, so tokens carry that domain as their
`iss`.

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
npm run test:coverage
npm run build
npm run test:e2e
```

CI measures all JavaScript and Vue application source under `src/` and `api/`,
including files not imported by tests. Test files are excluded. Coverage is
reported without a minimum percentage requirement. CI uploads detailed JSON,
JSON summary, and LCOV reports as the `unit-coverage` artifact so gaps remain
traceable to the tested revision.

Install Playwright browsers once if required:

```sh
npx playwright install chromium firefox
```

`npm run test:e2e` runs Chromium only; CI also runs Firefox. Run `npx playwright test --project=firefox` to check Firefox locally, or `npm run test:e2e:all` for both. Pass a specific file path to narrow a run when iterating.

`e2e/console-errors.spec.js` fails on console errors or uncaught exceptions during
main-route startup and app switching. It also checks an injected toolbar script
URL under the real deployment CSP. These checks use fixture APIs and a mocked
toolbar response; browser extensions and live Sentry delivery are outside their
scope. Run the file with `npm run test:e2e -- e2e/console-errors.spec.js`.

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

### Ask ChatGPT

The reader's **Ask ChatGPT** button, beside Reply and Forward, opens
chatgpt.com in a new tab with the open email prefilled: sender, date,
subject, recipients, and the plain-text body (or the text of the HTML body
when there is no plain part). Nothing is submitted until you add your own
question and send it. Very long bodies are cut off with an "[Email
truncated]" marker so the link stays within what ChatGPT accepts, and
attachments are not included. The button is disabled until the full body has
loaded, so a list preview is never sent in place of the message. This sends
the email's content to OpenAI, and because it travels in the link itself it
also lands in your browser history.

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

### Saved task filters

Saved filters live in the Tasks sidebar's **Favorites** section, between Today
and My Projects, ahead of any favorite projects. Press the section's **+** to
build a filter from rules on due date (overdue, today, tomorrow, the next 7
days, any date, no date), project (including Inbox), priority, and label. Each rule reads as a sentence (`Due is Today`,
`Project is not Work`); a filter matches **all** or **any** of its rules, and
holds up to ten. A saved filter lists the open tasks it fits from every
project, by due date with undated tasks last, and each row names the project
it lives in. Open one from the sidebar, double-click it to rename, hover for
edit and delete (delete offers Undo), or change its rules with **Edit filter**
under the title. A filter view has no compose row, dividers or re-arranging:
drag a row onto the sidebar to move it.

Filters are saved per account as one revisioned document in `users.prefs`
through the `cookie-web-tasks` Worker (`GET/PUT /task-filters`); the list is
served by `GET /task-items?view=page&project=filter:<id>&date=YYYY-MM-DD`.
No migration is needed; deploy the Worker before the web client.

GitHub news shows all repositories returned by the daily top-repository feed by default. Enable **Settings → Personalisation → Personalise GitHub repositories** to rank and select repositories against your interests on the next AI Today refresh; Product Hunt continues to use your interests independently.

### Task comments and attachments

Every task has a discussion thread, shown as **Comments** under the sub-tasks
in the task panel. Entries read oldest first and hold text, one attached
file, or both. Write in the composer at the foot (Enter sends, Shift+Enter
makes a newline), choose a file with **Attach file** (any type up to 25 MB;
the chosen file shows as a chip you can remove before sending) and press
**Comment**. Each entry names its author and time and is marked "(edited)"
once changed. Hover your own entries for **Edit** (in place; Enter saves,
Escape cancels) and **Delete** (asks first). An entry that keeps its text can
have its attachment removed from the chip's close button; an entry that is
only its attachment is deleted whole. Clicking an attachment opens images and
PDFs in a new tab and downloads anything else.

Threads are served by the `cookie-web-tasks` Worker under `/task-comments`
(`GET ?task=`, multipart `POST`, `PATCH`/`DELETE /:id`,
`GET /:id/attachment`); attachment bytes live in the same private R2 bucket
as uploaded files. Apply migration `0096_task_comments.sql` and deploy the
Worker before the web client. A deleted task takes its thread with it.

### Files and the folder browser

The Documents dashboard shows one folder at a time: subfolders first, then documents and uploaded files by name, as cards or rows (toggle in the toolbar; the choice is remembered in this browser). Click a folder in the sidebar or double-click its card to open it; the breadcrumb goes back up. The sidebar tree follows along, opening the current folder (or the folder holding the open document) and its parents. **Upload** or drop files onto the pane to add any file type up to 25 MB to the current folder. Image files show a thumbnail in place of the icon, loaded as they scroll into view. Images and PDFs open in an inline preview; other types download. Each item's menu offers open, rename, move, star (documents), download (files), and delete. Files live in a private R2 bucket behind the `cookie-web-tasks` Worker and are not searched, tagged, or read by Document AI. The Starred, tag, and search views keep the flat table.

### Document icons

Open a document and click its icon to the left of the title to choose one. The **Icons** tab offers a searchable set of Material Symbols icons that look the same on every device; the **Emoji** tab keeps the OS emoji. A Material Symbols icon is stored in the document's `emoji` field as `ms:<icon_name>` (the list lives in `src/lib/documentIcons.js`; run `npm run fetch:icon-font` after changing it so the self-hosted font subset includes the new glyphs). Icons autosave with other edits and appear in the sidebar and document list. If saving fails, the selection stays open for **Retry save** or **Save a copy**.

The AI button beside the document back arrow opens a panel on the right. Close it with the close button or Escape; the chat layout shows the document context, a scrollable conversation area, and a message composer. Drafts stay while the panel is closed and reset when switching documents. Send an instruction to GPT-5.6 Sol with the latest document snapshot and recent conversation. Review the response and use **Apply changes** to update the document, or **Create document** when starting from the dashboard. Newer local edits prevent stale suggestions from being applied; images, drawings and other non-text blocks are preserved. Failed requests keep the draft message for retry.

Document AI uses the authenticated `/document-chat` route on `cookie-web-ai`; the OpenAI key stays in the Worker. Enter sends, Shift+Enter inserts a newline, and switching documents cancels the pending response and clears the conversation. Full document context is limited to 500 blocks / 250,000 characters; oversized requests show an error rather than sending a truncated draft.

## Document tables and review fixes

New plain tables use a lightweight cell editor with Add row and Add column controls. Choose **Open spreadsheet** for formulas and advanced spreadsheet tools. Existing formula tables and workbook snapshots keep the full spreadsheet editor, with offscreen activation deferred until needed. Plain-table edits keep the existing content-grid storage/export format.

Document blocks become interactive only after Editor.js has installed its change observer. Task deep links wait for their detail lookup; temporary failures remain retryable. AI document creation completes its save without replacing a document opened while the request was pending.

### Estimated task duration

Use **Estimated time** in the task detail sidebar to choose 15, 30 or 45 minutes,
1 hour or 2 hours. Select the active preset again to clear it, or choose **Custom**
to enter 1–1440 minutes and clear that input to remove the estimate. The
**Advanced** Add Task form also accepts an estimated duration. Estimates can
be saved before scheduling a task and are preserved when duplicating a task or
completing a recurring occurrence. In Calendar, a task with a due time occupies
its estimated duration, defaulting to 30 minutes when no estimate is set. Tasks
without a due time remain in the all-day area.

Roll out migration `0098_task_duration.sql` before the updated task Worker, then
the web client. Duration changes appear in the task's Activity tab.

### Project favorites

Project rows in My Projects and Favorites show a muted count of unfinished
top-level tasks at the right edge with 60% opacity; zero counts are hidden. Counts
exclude subtasks, dividers, completed tasks, and tasks in nested projects.
They refresh after task changes. Deploy the updated task Worker before the
web client to supply `taskCount` on `GET /projects`; no migration is needed.

In Tasks, hover over a project and open its **…** menu, then choose **Add to
favorites**. Favorite projects appear in the **Favorites** section above My
Projects, after any saved filters, and remain in the project tree. The same
menu offers **Remove from favorites**. Favorites are saved per owned project
and are available across devices, including nested projects whose parents are
collapsed.

Deploy Cookie-Web migration `0099_project_favorites.sql` before the task Worker,
then the web client. `GET /projects` and project write responses include the
boolean `isFavorite`; `PATCH /projects` accepts it to add or remove a favorite.

Mail processing stays inside the Worker. The web app has no Processing folder,
count, or classification status; old Processing links open the normal inbox.

Document AI sends a random conversation UUID to the AI Worker, reusing it across
turns and retries and resetting it when switching documents. The Worker uses this
for Sentry Conversations without capturing prompts, document contents, or replies.

### Application metrics

The browser emits `web.operations` (counter) and `web.operation.duration`
(distribution, milliseconds) using the existing production `VITE_SENTRY_DSN`.
Sentry v11 enables metrics by default, independently of tracing sampling. Shared
application timers cover route readiness, reader readiness, message-body loading,
search, and `jsonRequest` operations across stores. The fixed `operation` label
identifies these timings; counts include both completed and failed attempts.
These are operation timings, not a count of every network fetch or user action.
The API Workers independently measure their HTTP and background handler calls;
the Vercel upload-token and proxy handlers do not have server-side Sentry clients.

Up to 100 early timing observations are buffered while the lazy SDK loads.
Development, E2E, and builds without a DSN do not collect metrics. The metric
filter allows only fixed metric names, operation labels, the `cookie-web`
service, and SDK environment/release labels so dashboard filters work. It strips
user identity and arbitrary SDK attributes. No mail content,
URLs, document IDs, or search terms are included.

After deployment, navigate, search, and open a message, then verify both metric
names in Sentry's Application Metrics view. CI verifies instrumentation and
privacy behavior; live ingestion requires authenticated access to Sentry.
When investigating missing metrics from older releases, clear the environment
filter: those releases stripped the SDK environment/release labels. Successful
envelope responses verify transport acceptance, not dashboard visibility.

### Vercel dependency security pins

The npm overrides pin Vercel Blob's `undici` to `6.29.1` and Vercel CLI
configuration's `zod` to `4.6.7` to address the dependency audit advisories
GHSA-4qv8-2p9j-2685, GHSA-xjj6-f33q-929c, and GHSA-mrhx-c7xc-m3w5.
These stay within the existing major versions. The scoped pins leave unrelated
consumers unchanged; remove them when the upstream dependency tree resolves to
patched versions without overrides.
