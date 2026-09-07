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

`0071_thread_muting.sql` adds persistent conversation muting on `threads.is_muted`.
Muted replies still refresh the inbox but do not create browser notification events.
The messages Worker exposes `mute_thread` / `unmute_thread` actions and removes pending
alerts on mute; the notifications Worker also checks mute status when claiming an alert.
Apply this migration before deploying `cookie-web-messages` and `cookie-web-notifications`,
then deploy Cookie-Web for the reader's Mute thread / Unmute thread control.

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

`0068_ai_label_rules.sql` adds `kind` (`conditions`/`ai`) and `prompt` to `label_rules`. A `kind = 'ai'` rule is defined by a plain-language prompt instead of conditions; Cookie-Worker's `mail-app-ingest` hands enabled prompts to the same classification call that auto-tags by label description and applies the rule's action above the shared 0.7 confidence bar, writing labels with `source = 'ai'` and `rule_id` provenance. Apply `0068` before deploying the `cookie-web-labels` and `mail-app-ingest` Workers that read the new columns.

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

## Composer uploads

`0060_outbound_attachments.sql` adds `outbound_attachments`, the home for files
picked in the composer or reply box. Inbound attachments are owned through
their message (`attachments.message_id` is `NOT NULL`), which leaves a draft's
uploads nowhere to live until the send that consumes them; this table owns them
by `user_id` instead.

Bytes never pass through the Vercel function: the browser gets a short-lived
Blob client token scoped to `outbound-attachments/<user_id>/` and uploads
directly, because a proxied upload would be capped at Vercel's ~4.5 MB request
body limit — well under the 20 MB `MAX_OUTBOUND_ATTACHMENT_BYTES` ceiling. The
registration call re-derives ownership from the stored pathname and records the
size `head()` reports, so a client cannot claim another account's blob or
misstate what it uploaded.

The migration also widens `scheduled_send_attachments` (0059) to reference
either source: `attachment_id` becomes nullable, `outbound_attachment_id` is
added, and a CHECK keeps exactly one of the two set. 0059's primary key is
replaced by one partial unique index per source plus a plain
`(scheduled_send_id)` index, since neither partial index alone covers a mixed
row set.

Apply `0060` before deploying code that serves `POST /api/send?resource=attachment`.
Both the send and cancel paths fall back to forwarded-attachment-only queries
while the table is missing, so a rolling deploy keeps existing mail working.

Abandoned uploads are swept by `POST /api/send?resource=flush` after each
batch, alongside the resolved scheduled sends and expired receipts it already
cleans up. A row is only eligible once it is a day old, is referenced by no
pending scheduled send, and shares its `blob_url` with no `attachments` row —
a sent copy records the same blob, and deleting those bytes would empty an
attachment the user can still open in their sent mail.

## Drafts

`0061_drafts.sql` adds `drafts` and `draft_attachments`, backing composer
autosave and the Drafts view. Before this, the only outbound state that
survived a reload was the undo-send holding row in `scheduled_sends`; a
half-written message lived in the browser tab and died with it.

Drafts are deliberately not `messages` rows. `messages` requires
`from_address`, `recipients`, `thread_id` and `sent_at`, carries the search
tsvector and thread counters, and is append-only in practice. A draft is empty
when it is created, has none of those, and is rewritten every few seconds
while someone types.

`draft_attachments` uses the same two-source shape as
`scheduled_send_attachments`: `attachment_id` for a forwarded inbound file,
`outbound_attachment_id` for a composer upload, with a CHECK keeping exactly
one set. Ownership is re-resolved on every save, so an id the user does not
own is dropped rather than stored.

The orphaned-upload sweep in `POST /api/send?resource=flush` now also spares
any upload a draft references (see 0060). A draft can sit untouched for weeks,
well past the 24-hour retention window, and its files must outlive it.

Apply `0061` before deploying the `cookie-web-drafts` Worker (Cookie-Worker
repo), which serves `GET /drafts`, `POST /drafts`, and
`GET/PATCH/DELETE /drafts/:id`.

## Historical migration

The production database moved from Neon to Supabase in July 2026. [`supabase-cutover.md`](supabase-cutover.md) is retained as a historical record, not a current runbook.

## Recurring tasks

`0066_task_items_recurrence.sql` adds nullable `task_items.recurrence`, with a
constraint requiring a due date and task kind whenever recurrence is set.
Existing tasks remain non-recurring. Apply this migration before deploying
Cookie-Worker's updated task API, then deploy Cookie-Web.

## Natural-language task metadata

`0067_task_items_time_and_labels.sql` adds nullable `due_time` and `time_zone`
columns plus a non-null `labels` text array. A due time must have both a due
date and time zone; dividers cannot carry times or labels. Existing tasks keep
no due time and an empty label list. Apply this migration before deploying the
task API that reads and writes these fields.

## Automatic priority reply drafts

`0069_priority_reply_drafts.sql` adds independent reply-draft status, attempts,
and a lease timestamp to `message_ai`, plus `drafts.is_ai_generated`. Terminal
state outlives the draft, preventing regeneration after sending or discarding.
The existing Drafts permissions and RLS remain in force. A trigger sends only
a content-free inbox refresh signal after an AI draft is first inserted.
Apply before deploying `mail-app-ingest` and `cookie-web-drafts` in Cookie-Worker.

## Scheduled send retries

Apply `0070_scheduled_send_requests.sql` before deploying the updated
`cookie-web-send` Worker, then deploy Web. It adds an optional client request id
and payload hash, unique per owner, so retries of a queued send return the same
row. Reusing an id with different content returns HTTP 409. Clients without an
id keep the existing scheduling behavior. Request records follow the scheduled
row's existing cancellation and retention lifecycle.

## Live thread summaries

`0072_thread_summaries.sql` stores a one-line summary on `threads`, separately
from the per-message enrichment in `message_ai.summary`. The accompanying
message and AI Workers compare `ai_summary_message_id` with the newest live
message, so a reply immediately makes an old summary stale and the Web reader
regenerates it after the existing Realtime inbox refresh. Apply this migration
before deploying `cookie-web-ai`, `cookie-web-emails`, `cookie-web-messages`,
`cookie-web-search`, and Cookie-Web.
