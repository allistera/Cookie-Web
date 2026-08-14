# Cookie Web

Cookie is a private, AI-assisted email application. The Vue frontend and authenticated Vercel functions provide inbox browsing, search, labels, AI compose, mailbox Q&A, and outbound mail.

The production application is available at [mail.infinitywave.online](https://mail.infinitywave.online).

## Architecture

```text
Cloudflare Email Routing
  -> Cookie-Worker
       -> forward original mail
       -> store through Hyperdrive
       -> OpenAI enrichment and embeddings

Vue 3 browser application
  -> Auth0-protected Vercel functions
       -> Supabase Postgres + pgvector
       -> OpenAI Responses and embeddings APIs
       -> Resend
```

Cookie-Worker lives in the separate [Cookie-Worker repository](https://github.com/allistera/Cookie-Worker). Database migrations remain in this repository because both runtimes share the same schema.

## Features

- Inbox, Starred, Sent, Snoozed, Spam, Done, and label views.
- Auth0 authentication and per-user mailbox queries.
- Debounced keyword and semantic search over stored mail, with filters such as
  `tag:Personal`, `sender:foo@bar.com`, `to:`, `has:attachment`, `before:`, and `after:`.
- Mailbox Q&A with retrieved email sources.
- AI Today: gathered to-dos (Todoist tasks due today plus action items extracted
  from important mail), a nightly digest grouping unread mail into topics to
  catch up on, and a personalised news round-up (new GitHub repos and Product
  Hunt launches ranked against your interests, plus BBC UK headlines, which are
  never filtered). All are produced by the `data-enricher` Worker in
  Cookie-Worker and read through `/api/tasks`. Refresh rebuilds the digest and
  news on demand when `ENRICHER_RUN_URL` and `ENRICHER_TRIGGER_TOKEN` are set.
- Settings → Personalisation edits the topics the news round-up is ranked
  against. Stored server-side in `users.prefs` rather than the browser, since
  the Worker reads them overnight.
- AI Compose with an explicit review-and-insert step; it never sends automatically.
- Per-label auto-tag controls and conservative spam classification.
- Outbound delivery through Resend with stored sent copies.
- Best-effort sent-mail read receipts using opaque tracking tokens.
- Supabase Realtime pings for inbox refreshes.
- Opt-in browser notifications for new mail while Cookie is open in a background tab.

See [AI capabilities: decision and implementation](docs/AI-CAPABILITIES-REPORT.md) for the AI design, safety boundaries, and alternatives considered.

## Technology

| Area | Technology |
| --- | --- |
| UI | Vue 3, Pinia, Vue Router, Vite |
| Hosting and API | Vercel Functions |
| Authentication | Auth0 |
| Database | Supabase Postgres with pgvector |
| Realtime | Supabase Realtime broadcast |
| AI | OpenAI Responses and Embeddings APIs |
| Outbound email | Resend |

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

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres connection used by Vercel functions and migrations. |
| `OPENAI_API_KEY` | Embeddings, mailbox Q&A, and AI Compose. |
| `OPENAI_COMPOSE_MODEL` | Optional AI Compose model override. |
| `RESEND_API_KEY` | Outbound email delivery. |
| `TODOIST_API_TOKEN` | Optional. Lets AI Today close a Todoist task when it is marked done. Without it, "done" only clears the task from Cookie. |
| `EMAIL_FROM` | Optional sender identity for outbound mail. |
| `SCHEDULED_SEND_FLUSH_TOKEN` | Bearer secret authorizing `POST /api/send?resource=flush`. Shared with the `scheduled-send-flusher` Cloudflare Worker in Cookie-Worker, which is the only caller. |
| `ENRICHER_RUN_URL` | Optional. The `data-enricher` Worker's `POST /run` URL. Lets AI Today's refresh rebuild the digest on demand; without it refresh only re-reads the stored one. |
| `ENRICHER_TRIGGER_TOKEN` | Optional. Bearer secret sent to `ENRICHER_RUN_URL`; must match that Worker's `HTTP_TRIGGER_TOKEN`. |
| `PUBLIC_APP_URL` | Optional public origin used for read-receipt pixels; Vercel's production URL is used when omitted. |
| `VITE_AUTH0_DOMAIN` | Auth0 tenant domain exposed to the browser. |
| `VITE_AUTH0_CLIENT_ID` | Auth0 SPA client ID exposed to the browser. |
| `VITE_AUTH0_AUDIENCE` | Auth0 API audience exposed to the browser. |
| `VITE_SUPABASE_URL` | Supabase project URL used for Realtime. |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key used for content-free Realtime pings. |

Vercel stores production values. GitHub Actions stores only the secrets required by migrations and embedding backfills.

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

The weekly `Backfill Embeddings` workflow repairs messages whose best-effort embedding call did not finish. Cloudflare Worker deployment and email-routing operations are documented in the Cookie-Worker runbook.
