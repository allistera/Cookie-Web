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

`0039_api_rate_limits.sql` adds server-only, durable per-user counters for AI
and enricher requests. The AI endpoints share one scope, so switching routes
or serverless instances cannot multiply the configured allowance.

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

## Calendar auto-scheduled

`0033_calendar_auto_scheduled.sql` adds `calendar_events.is_auto_scheduled`
(default `false`) so the Calendar view's "Auto-scheduled" insight card can
report a real count instead of hardcoded copy. No feature sets this column to
`true` yet, so the card reads 0 until an actual auto-scheduling feature
exists — this migration is plumbing ahead of that feature, not the feature
itself.

## Query indexes

`0041_calendar_events_recurring_index.sql` adds a partial index on
`calendar_events (user_id) WHERE recurrence_rule IS NOT NULL`. Every calendar
load unconditionally includes recurring masters regardless of the requested
range (a series row's `event_date` is only its start), and this branch wasn't
covered by `calendar_events_user_date_idx`.

`0042_recipients_trgm_index.sql` adds a `pg_trgm` GIN index on
`(recipients::text)` so the `to:` search operator's `ILIKE '%...%'` predicate
(api/_lib/retrieval.js) can use an index. The full-text `search` tsvector
(0017) can't substitute here: its parser tokenizes each email address as one
lexeme, so it can't match a partial address the way `to:` currently does.

`0043_message_labels_rule_index.sql` adds a partial index on
`message_labels (rule_id) WHERE rule_id IS NOT NULL`. Deleting a label rule
sets it `NULL` on every referencing row (`ON DELETE SET NULL`), and
`message_labels` is the largest, continuously-growing table in the schema.

`0044_scheduled_sends_and_receipts_cleanup_indexes.sql` adds a
`scheduled_sends (user_id, scheduled_for) WHERE status = 'failed'` index
matching `listScheduledSends`'s `status IN ('pending', 'failed')` read (only
the `'pending'` half had index support before), and a
`message_read_receipts (expires_at)` index supporting the new periodic sweep
of expired receipts and resolved scheduled sends that
`POST /api/send?resource=flush` now performs after each batch — the flush job
is the only periodic cron trigger this app has, so both tables' cleanup piggybacks
on it instead of adding a new endpoint.

`0045_message_fk_indexes.sql` adds indexes on `tasks.message_id`,
`summaries.message_id`, `scheduled_sends.reply_to_message_id`, and
`scheduled_sends.sent_message_id` — FK columns referencing `messages(id)`
with no index of their own. The app only soft-deletes messages today, so
this is insurance against a future hard-delete/purge path triggering an
unindexed cascade scan, not an active hot path.

`0047_daily_note_calendar_events.sql` adds `calendar_events.source_document_id`
/ `source_block_id` and a partial unique index on the pair, so a typed
time-range line in a Daily note maps to exactly one event and repeat saves
upsert it (`ON CONFLICT (source_document_id, source_block_id)`) instead of
creating duplicates. `source_document_id` is `ON DELETE SET NULL`, not
`CASCADE` — deleting the note detaches its events rather than deleting real
calendar commitments along with it.

`0052_follow_up_reminders.sql` adds optional follow-up timestamps to sent
messages and pending scheduled sends. A partial due-reminder index supports
Inbox resurfacing without scanning ordinary sent mail.

## Task priority

`0058_task_items_priority.sql` adds `task_items.priority` (`smallint NOT NULL
DEFAULT 4`, checked to `1..4`), Todoist-style: 1 is the most urgent, 4 is the
default and reads as "no priority" in the Tasks app. The column is not
nullable — every task has a priority, and "unset" is just the lowest level.

Apply `0058` before deploying Cookie-Worker code that reads or writes
`task_items.priority`; the `cookie-web-tasks` Worker selects and returns the
column on every task read.

## Forwarded attachments

`0059_scheduled_send_attachments.sql` stores ownership-checked attachment
references for pending outbound messages. This lets Send Later carry private
attachments without exposing Blob URLs or file bytes to the browser; rows are
removed automatically with their scheduled send.

Apply `0059` before enabling forwarded attachments. During a rolling deploy,
both send handlers fall back to attachment-free cancel/flush queries so mail
already queued by the previous release keeps working until the table exists.

## Historical migration

The production database moved from Neon to Supabase in July 2026. [`supabase-cutover.md`](supabase-cutover.md) is retained as a historical record, not a current runbook.
