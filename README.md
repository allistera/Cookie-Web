# Cookie-Web

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
  Cloudflare Worker (Cookie-Worker repo), not this app's own API. Refresh
  rebuilds triage and news on demand; the trigger URL/token for that now live
  in `cookie-web-tasks`'s own Cloudflare config, not Cookie-Web's.
- Settings → Personalisation edits the topics the news round-up is ranked
  against. Stored server-side in `users.prefs` rather than the browser, since
  the Worker reads them overnight.
- AI Compose with an explicit review-and-insert step; it never sends automatically.
- Per-label auto-tag controls and conservative spam classification.
- Outbound delivery through Resend with stored sent copies.
- Best-effort sent-mail read receipts using opaque tracking tokens.
- Supabase Realtime pings for inbox refreshes.
- Opt-in browser notifications for new mail while Cookie is open in a background tab.

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
