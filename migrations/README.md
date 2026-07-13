# Database Migrations

Plain-SQL migrations for the Cookie email service, targeting Postgres
(Neon via the Vercel Marketplace).

## Conventions

- Files are numbered and applied in order: `0001_...sql`, `0002_...sql`.
- Each migration is wrapped in a transaction (`BEGIN; ... COMMIT;`).
- Migrations are append-only — never edit an applied migration; add a new
  one that alters the schema instead.
- Attachment/raw-message bytes live in Vercel Blob; the database stores
  metadata and URLs only.

## Applying

Against a Neon database (connection string in `DATABASE_URL`):

```bash
psql "$DATABASE_URL" -f migrations/0001_initial_email_schema.sql
```

Note that standalone scripts do not auto-load `.env.local`, so export the
variable first (or use `dotenv-cli`):

```bash
source <(grep -v '^#' .env.local | sed 's/^/export /')
```

## AI enrichment

`0010_ai_enrichment.sql` adds durable OpenAI enrichment state, per-label
auto-tag preferences, spam verdicts, and label provenance. Apply it before
deploying a `Cookie-Worker` version that imports `src/enrich.js`; the ingest
transaction creates the pending enrichment row for each new inbound message.
`0011_backfill_ai_pending.sql` queues existing inbound messages, which the
Worker's 15-minute recovery sweep processes in batches of three.

AI failures are recoverable state (`message_ai.status = 'failed'`) and never
change the mail forwarding outcome. Only a spam score of at least `0.98`
moves a message out of Inbox and into the hidden Spam folder.
