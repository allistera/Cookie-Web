# AI capabilities: decision and implementation

Date: 13 July 2026
Scope: private, single-user Cookie deployment

## Status

Option A was selected and implemented across Cookie-Web and Cookie-Worker.

The shipped release provides per-label auto-tag controls, conservative spam detection, a hidden Spam folder, and review-before-send AI Compose.

Cookie-Web commit `f5b2a4a` contains the UI, authenticated APIs, and database migrations. Cookie-Worker commit `b1226ef` contains arrival-time enrichment and scheduled recovery.

## Architecture

```text
Inbound email
  -> Cloudflare Email Worker
       1. parse and store
       2. forward original email
       3. close the ingest database client
       4. enrich with a fresh Hyperdrive client in waitUntil
       5. recover pending or failed work every 15 minutes

Browser
  -> Auth0-protected Vercel functions
       -> inbox, labels, search, compose, ask, send
       -> Supabase Postgres + pgvector
       -> OpenAI and Resend
```

Forwarding remains the primary outcome. Storage, classification, embedding, and monitoring failures do not intentionally prevent delivery.

## Shipped capabilities

### Auto-tagging

Each user label has an `auto_apply` setting. The label name and description are supplied to the classifier only when that setting is enabled.

The model may return only label IDs provided by the application. Cookie-Worker validates IDs and confidence locally before writing them.

Model-applied labels store source, confidence, model, prompt version, and creation time. Manual labels are preserved when enrichment is rerun.

### Spam detection

Spam classification is part of the same structured response as auto-tagging. This avoids a second model request over the same private email content.

Only a model spam verdict with a score of at least `0.98` moves a message out of Inbox. Lower scores remain in Inbox or enter internal review state.

Spam is a recoverable system label, not deletion. The folder is hidden under **More** in the sidebar, and unread Inbox counts exclude confirmed spam.

### AI Compose

`POST /api/compose` is an Auth0-protected Vercel function. It accepts a user instruction, composer state, and an optional owned message ID for reply context.

The server fetches reply context rather than trusting browser-supplied email content. Input lengths and request rates are bounded.

The endpoint returns a subject and body draft. The user must insert, edit, and send it through the existing email route; generation never calls Resend.

## Runtime decision

### Selected: Option A, Worker `waitUntil`

This was the smallest design that produced near-real-time results for one user while reusing the existing email Worker, Hyperdrive binding, and OpenAI secret.

The original risk was holding the ingest database client during model latency. The implementation closes that client first and creates a separate client for enrichment.

Durable `pending` and `failed` rows support repair. A scheduled sweep processes three stale rows every 15 minutes, keeping recovery bounded.

### Alternatives retained for later

| Option | Best use | Why it was not selected now |
| --- | --- | --- |
| Cloudflare Queues | Higher volume or stricter delivery guarantees | Adds a producer, consumer, queue, dead-letter handling, and deployment surface. |
| Scheduled batch only | Lowest coupling to ingestion | Delays labels and spam status even when arrival-time work would succeed. |
| Vercel enrichment endpoint | Centralised AI code | Couples Worker delivery to another service unless a queue or signed retry protocol is added. |
| Supabase Edge Function or Queue | Supabase-centred operations | Introduces another runtime and duplicates existing Worker responsibilities. |
| Browser or local inference | No server-side AI vendor | Cannot classify mail reliably while the browser is closed and complicates model delivery. |

Move to Cloudflare Queues if recovery lag, invocation interruption, or mail volume becomes material. The database contract can remain unchanged.

## Data model

Migration `0010_ai_enrichment.sql` adds:

- `labels.auto_apply`.
- Provenance columns on `message_labels`.
- One `message_ai` row per message with status, spam verdict, score, an optional user-requested summary, priority, provider, model, prompt version, and error state.

Migration `0011_backfill_ai_pending.sql` queues historical inbound messages. Sent copies are deliberately excluded from spam and auto-tag processing.

## Provider decision

OpenAI is the initial provider because Cookie already uses OpenAI embeddings and mailbox Q&A. Reusing one provider keeps credentials, monitoring, and data-flow review simple.

The default classification and compose model is `gpt-5.6-luna`. Worker configuration uses `AI_MODEL`; Compose supports `OPENAI_COMPOSE_MODEL`.

A generic multi-provider abstraction is intentionally absent. Add one only after a second provider is adopted and evaluated against the same private examples.

## Privacy and safety

- AI calls run only on authenticated requests or private Worker invocations.
- Secrets remain in Vercel, Cloudflare, or GitHub secret stores.
- Email content is treated as untrusted data, not model instructions.
- Structured outputs are schema-constrained and validated locally.
- Spam actions are reversible and require high confidence.
- AI Compose cannot send mail.
- Logs exclude email bodies, model inputs, model outputs, and credentials.
- Stored provenance supports later correction and prompt/model changes.

## Reliability and operations

New inbound messages receive a durable `pending` row inside the storage transaction. Successful enrichment updates embeddings, tags, spam state, and priority together. It never generates or overwrites summaries; Cookie Web creates those only after an authenticated user requests one in the reader.

Failures set `message_ai.status = 'failed'` without changing forwarding. The recovery cron retries stale pending and failed rows.

The existing weekly Cookie-Web embedding backfill remains a separate safety net for any row whose vector is still null.

Production verification should confirm delivery first, then storage, `ai_enriched` logs, the `message_ai` result, and Inbox or Spam visibility.

## Cost expectations

Personal mailbox volume should remain low-cost because classification and embedding requests run once per inbound message, summaries and Compose are user-triggered, and recovery is bounded.

Actual cost depends on message length, model pricing, and Compose usage. Monitor provider usage before adding routing logic, prompt caching, or another model tier.

## Next improvements

1. Add **Not spam** feedback and sender allow-listing.
2. Add manual removal feedback for incorrect AI labels.
3. Add reply-aware AI Compose directly inside the reading panel.
4. Measure classification precision, recovery lag, latency, and cost.
5. Adopt Cloudflare Queues only when those measurements justify it.
