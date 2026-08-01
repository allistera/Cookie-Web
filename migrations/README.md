# Database migrations

Cookie uses append-only SQL migrations against Supabase Postgres. The same schema supports Cookie-Web and Cookie-Worker.

## Conventions

- Files use ordered names such as `0010_ai_enrichment.sql`.
- Every migration is transactional.
- Applied filenames are stored in `schema_migrations`.
- Never change an applied migration; add a new file instead.
- Runtime code must remain compatible until its required migration is applied.

## Apply pending migrations

Set an IPv4-reachable Supabase pooler connection in `DATABASE_URL`, then run:

```sh
./migrations/migrate.sh
```

The script creates `schema_migrations` if needed, applies pending files in order, and safely skips files already recorded.

Pushes to `main` that change `migrations/**` run the same script through the `Migrate Database` GitHub Actions workflow.

## Connection guidance

Use the Supavisor session pooler on port `5432` for GitHub-hosted migrations. GitHub runners cannot depend on an IPv6-only direct database host.

Use a development project for local migration testing. Do not point routine local commands at production.

## AI enrichment migrations

`0010_ai_enrichment.sql` adds per-label auto-tag settings, model-label provenance, and durable `message_ai` enrichment state.

Apply `0010` before deploying Cookie-Worker code that creates pending enrichment rows during inbound storage.

`0011_backfill_ai_pending.sql` queues existing inbound messages. Cookie-Worker's 15-minute recovery sweep processes three stale pending or failed rows per run.

AI failure state is recoverable and never changes the mail-forwarding outcome. Only spam scores of at least `0.98` are excluded from Inbox.

## Browser notification events

`0016_browser_notification_events.sql` adds short-lived, opaque event tokens for opt-in browser notifications. Realtime broadcasts only the token; an authenticated Vercel function leases and resolves its owned message before the browser can display sender and subject. The table is server-only, old unclaimed events are pruned after 24 hours, and all notification failures remain isolated from inbound message ingestion.

## Read receipts

`0021_read_receipts.sql` stores opaque per-message tokens and best-effort open timestamps for sent mail. The tracking pixel contains no mailbox or message identifier, the receipt table is server-only, and stored sent HTML excludes the pixel so opening Cookie's own sent copy does not mark it read. Image blocking can suppress receipts and security scanners can trigger them, so the UI treats status as indicative rather than guaranteed.

`0028_security_boundaries.sql` expires receipt capabilities after 90 days,
deduplicates rapid receipt opens in the API, and adds the server-only durable
per-user quota row used to bound outbound mail across function instances.

## Label rules

`0029_label_rules.sql` adds `label_rules` and `label_rule_conditions` for deterministic, user-defined tagging (subject/body/from/to conditions, matched with `contains`/`equals`/`starts_with`/`ends_with`, combined with `all`/`any`). Cookie-Worker evaluates enabled rules inside the same transaction that stores an inbound message and writes matches to `message_labels` with `source = 'rule'` and the new `rule_id` provenance column. Unlike AI auto-tagging, rule matching is synchronous and has no recovery cron because it never leaves the message's own storage transaction.

Apply `0029` before deploying Cookie-Worker code that reads `label_rules`.

`0030_rule_actions.sql` adds `label_rules.action` (`apply_label` or `mark_done`) and makes `label_id` nullable, so a rule can mark matching mail done (`is_archived`/`is_unread`, the same state the "Marked done" archive flow sets) instead of only applying a label. A CHECK keeps `label_id` required for `apply_label` and null for `mark_done`.

Apply `0030` before deploying Cookie-Worker code that reads `label_rules.action`.

## Scheduled sends

`0032_scheduled_sends.sql` adds `scheduled_sends` for "Send Later": a composed
message queued for a future `scheduled_for` instead of sending immediately.
Unlike inbound snooze (`0012_scheduled_messages.sql`), where a due message
just becomes visible again the next time it's queried, sending mail is an
active operation — so a Cloudflare Worker cron in Cookie-Worker polls
`POST /api/send?resource=flush` on an interval, and that endpoint claims due
rows, calls the mail provider, and files the result back onto `messages` the
same way an immediate send does.

Apply `0032` before deploying the Cookie-Worker `scheduled-send-flusher`
worker, since its flush calls will 404/error against an API that doesn't yet
recognize `resource=scheduled`/`resource=flush`.

## Historical migration

The production database moved from Neon to Supabase in July 2026. [`supabase-cutover.md`](supabase-cutover.md) is retained as a historical record, not a current runbook.
