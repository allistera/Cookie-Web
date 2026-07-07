# RUNBOOK — mail-app-ingest

Cloudflare Email Worker: receives inbound mail on the domain's catch-all route,
stores it in the app's Neon Postgres (`threads`/`messages`/`attachments`), and
forwards the original to the verified destination. **Forwarding always wins**:
any storage failure is logged and the mail is forwarded anyway.

## Deploy (GitHub Workflow — no local deploys)

1. One-time repo secrets (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — token with Workers Scripts:Edit on the account
   - `CLOUDFLARE_ACCOUNT_ID`
   - `DATABASE_URL` — already present (used by migrate.yml); the deploy job
     pushes it to the worker as its secret
2. Schema: `migrations/0003_inbound_email_fields.sql` is applied by the
   `Migrate Database` workflow automatically on push to main.
3. Deploy: Actions → **Worker mail-app-ingest** → Run workflow (main).
   The `deploy` job runs only on manual dispatch, after the test job passes.

## Email Routing setup (dashboard, one-time)

1. Cloudflare dashboard → the domain → Email → Email Routing.
2. **Destination addresses**: add `allisteraall@gmail.com`, click the
   verification link Cloudflare emails. `forward()` fails until verified.
3. **Routing rules**: set the **catch-all** action to
   "Send to a Worker" → `mail-app-ingest`.

## Live round-trip test

1. Send mail from any external account to `anything@<domain>`.
2. Expect: the message arrives at allisteraall@gmail.com, a row appears in
   `messages` (visible in the app inbox), and `wrangler tail` shows a
   `{"event":"stored","outcome":"inserted",...}` log line.
3. Result of the first live round-trip: _pending Phase 5_.

## Logs

```sh
cd workers/mail-app-ingest && npx wrangler tail mail-app-ingest
```

Log lines are JSON: `stored` (with `outcome`, `message_id`, `raw_size`) or
`store_failed` (with `error`, `message_id`). Bodies, subjects, and connection
strings are never logged.

## Rollback

- Worker: `npx wrangler rollback` (or re-dispatch the deploy workflow from the
  last good commit).
- Route: flip the catch-all rule back to plain forwarding in the dashboard —
  mail keeps flowing with no worker in the path.

## Local development

```sh
cd workers/mail-app-ingest
cp .dev.vars.example .dev.vars   # fill with the Neon vercel-dev branch URL
npm run dev                      # wrangler dev on http://localhost:8787
```

Trigger the handler with a fixture (the local endpoint requires a
`Message-ID` header in the body):

```sh
curl --request POST 'http://localhost:8787/cdn-cgi/handler/email' \
  --url-query 'from=sender@example.com' \
  --url-query 'to=inbox@example.org' \
  --data-binary @test/fixtures/simple.eml
```

`wrangler dev` prints the forward call instead of forwarding for real.
Re-POSTing the same fixture must log `"outcome":"duplicate"` and leave row
counts unchanged.

## Known v1 caveats

- Attachments are metadata-only (`blob_url` is null); binary storage is a
  future R2 iteration (hook point: `src/parse.js`, attachment mapping).
- The store step has a 5 s budget; slower Neon calls are abandoned (logged as
  `store_failed`) and the mail is still forwarded — the retry usually lands.
- A concurrent MTA retry can, in a rare race, leave an orphan `threads` row
  (never rendered by the UI). Duplicate messages themselves are blocked by the
  `(user_id, message_id)` unique index.
- Inbound mail is stored against the single `users` row matching
  `OWNER_EMAIL`; if none exists the message is forwarded but not stored.
