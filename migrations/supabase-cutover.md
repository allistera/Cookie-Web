# Neon → Supabase cutover runbook

The application code is database-agnostic after the postgres.js driver swap —
every consumer reads plain `DATABASE_URL`, so the cutover is a data copy plus
an env-var repoint. Ingestion (Cookie-Worker) is idempotent on
`(user_id, message_id)`, and email senders retry on temporary failures, so a
short ingestion pause loses nothing.

## Prerequisites

- Supabase project created, region matching the Vercel functions region.
- `vector` extension enabled (the migration script also does this).
- Connection strings in hand:
  - **Direct** `db.<ref>.supabase.co:5432` — for migration, `migrate.yml`.
  - **Supavisor transaction pooler** `:6543` — for Vercel + Cookie-Worker
    runtime (`prepare: false` is already set in `api/_lib/db.js`).
- Driver swap deployed and verified while still pointing at Neon.

## Cutover order

1. **Pause ingestion**: disable the Cookie-Worker email route in the
   Cloudflare dashboard (senders queue and retry; nothing is lost).
2. **Copy data**: `NEON_DATABASE_URL=<prod> SUPABASE_DATABASE_URL=<direct>
   ./scripts/migrate-to-supabase.sh` — dumps, restores, verifies row counts.
   Abort on any mismatch.
3. **Repoint runtime env vars** to the pooler URL:
   - Vercel: `DATABASE_URL` (production) → redeploy.
   - Cookie-Worker: `DATABASE_URL` secret (via GitHub Workflow / wrangler
     secret), plus swap its driver first — see task in Cookie-Worker repo.
   - GitHub Actions: set the `SUPABASE_DATABASE_URL` secret (SESSION pooler
     `:5432` string — runners have no IPv6 for the direct host) so
     `migrate.yml` applies migrations to both databases during the
     transition; `backfill-embeddings.yml` keeps using `DATABASE_URL`.
     After decommissioning Neon: move the Supabase string into
     `DATABASE_URL`, delete `SUPABASE_DATABASE_URL`, and remove the
     transition step from `migrate.yml`.
4. **Verify**: load the app (inbox renders, search works, send + sent copy
   stored), run `npx playwright test` against prod, send a test email
   end-to-end once the route is re-enabled.
5. **Resume ingestion**: re-enable the email route. Queued senders retry;
   `ON CONFLICT DO NOTHING` absorbs any replays.

## Rollback

Neon stays untouched throughout. Rollback = flip the env vars back to the
Neon connection strings. Only decommission the Neon project after a
multi-day soak with ingestion, search, and send all verified on Supabase
(and note: emails ingested into Supabase after cutover would need copying
back before a late rollback).

## Post-cutover

- Update `neon-database-branches` assumptions in tooling/docs (Neon MCP
  branch IDs no longer apply).
- Revisit dev-database workflow: Supabase has no copy-on-write data
  branches; options are a second Supabase project for dev or local Postgres
  via `supabase start`.
- Realtime inbox updates can now use Supabase Realtime (`postgres_changes`
  on `messages` with Auth0 as third-party auth provider + RLS) instead of
  polling.
