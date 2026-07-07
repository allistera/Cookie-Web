# Migrations

This worker's schema changes live in the repo-root [`migrations/`](../../../migrations/) directory
(`0003_inbound_email_fields.sql`) so they are tracked in `schema_migrations` and applied by the
existing `migrate.yml` GitHub workflow (production, on push to main) or locally via:

```sh
DATABASE_URL="<neon-branch-url>" ./migrations/migrate.sh
```
