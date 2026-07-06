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

## Planned

- AI layer (suggested to-dos, topic digests, pgvector embeddings) will be
  added as a follow-up migration once the core schema is in use.
