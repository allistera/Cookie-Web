# AI capabilities architecture report

Date: 13 July 2026

## Executive recommendation

Cookie already has most of the foundation needed for useful AI features:

- OpenAI embeddings are created for inbound and sent messages.
- Supabase Postgres stores those vectors with pgvector.
- The Vercel layer already provides authenticated semantic search and mailbox Q&A.
- Labels and label descriptions already exist.
- The composer already has a “Help me write” surface, although its draft is currently hard-coded.

The best design is therefore not a new standalone AI platform. It is two small, deep modules placed at the two seams where AI work naturally occurs:

1. **Arrival-time enrichment in the Cloudflare email Worker** for auto-tagging, spam scoring, summaries, and the existing embedding. Run this after the message has been stored and after forwarding remains safe. For the first version, extend the existing Cloudflare waitUntil path and add a repair/backfill job. Move it to Cloudflare Queues only if missed enrichments or longer jobs become a real problem.
2. **Request-time assistance in the Vercel API layer** for AI compose, reply drafting, rewriting, summarising, and mailbox Q&A. The browser should send an authenticated intent and message ID; the server should fetch the email context and call the model. A generated draft must never send automatically.

Use OpenAI initially because Cookie already sends embeddings and Q&A context there. Add no generic multi-provider abstraction until a second provider is actually adopted. The current model names should be configuration rather than scattered constants, and model changes should be evaluated on a small private test set.

## Current stack and existing AI

    Inbound email
        |
        v
    Cloudflare Email Worker
      parse -> store through Hyperdrive -> Supabase Postgres
        |                                  |
        |                                  +-> messages, labels, pgvector
        +-> forward original email
        +-> waitUntil(OpenAI embedding)

    Browser (Vue + Pinia, hosted by Vercel)
        |
        +-> Auth0-authenticated Vercel functions
              +-> inbox/search/labels -> Supabase Postgres
              +-> ask -> hybrid retrieval + OpenAI answer
              +-> send -> Resend + sent-copy embedding
        |
        +-> Supabase Realtime inbox notification

Relevant implementation points:

- api/ask.js already performs authenticated hybrid retrieval and sends a bounded set of email excerpts to OpenAI.
- api/search.js already combines Postgres full-text and pgvector rankings.
- api/_lib/embeddings.js and migration 0005 already standardise on text-embedding-3-small with 1,536 dimensions.
- api/send.js sends through Resend, stores the sent copy, and embeds it on a best-effort basis.
- labels, message_labels, label descriptions, and label filtering already exist.
- Cookie-Worker/src/index.js already schedules best-effort post-ingest embedding with ctx.waitUntil.
- src/App.vue already exposes a drafting UI, but src/stores/inbox.js currently types out a fixed sample draft rather than calling AI.

There is also a naming mismatch worth fixing when AI compose becomes real: the UI and source names say “Gemini”, while the production AI implementation uses OpenAI. Provider-neutral names such as “Cookie AI”, AiChatDrawer, and requestDraft will keep the interface honest if the provider changes later.

## Recommended placement by capability

| Capability | Best location | Why |
| --- | --- | --- |
| Auto-tagging | Cloudflare Worker post-ingest enrichment | It has the parsed message, the database connection, and an existing background AI path. Results are ready before the message is normally read. |
| Spam detection | Same post-ingest enrichment call | Spam and tags use the same inputs. One structured model response is cheaper and easier to keep consistent than two calls. |
| Message summary or priority | Same post-ingest enrichment call | Computed once, stored, and reused by every UI view. |
| AI compose or reply | Authenticated Vercel endpoint, for example POST /api/compose | This is interactive, uses current composer state and optional thread context, and must remain behind Auth0. |
| Rewrite, shorten, change tone | Same compose endpoint with an explicit operation | Same security, latency, and review requirements as drafting. |
| Mailbox Q&A | Existing POST /api/ask | It already has the right retrieval and authorisation path. Refactor its provider call into the same request-time AI module later. |
| Embeddings | Keep the existing Worker and Vercel paths initially | They work today. Fold inbound embedding into enrichment, but do not risk search while adding unrelated features. |
| Backfill and reprocessing | Existing GitHub workflow pattern or a protected Vercel cron endpoint | It can repair rows with pending or failed AI status and re-run messages after a prompt/model change. |

## The recommended modules

### 1. MessageEnricher

External interface:

    enrichMessage(messageId) -> {
      spam: { verdict, score, reasons },
      labelIds: [{ id, confidence }],
      summary,
      priority
    }

The caller supplies only a message ID. The implementation loads the owned message, active labels, label descriptions, allow/block rules, and any required headers from Postgres. It then makes one structured-output model request, validates the result, and writes it transactionally.

This keeps provider details, prompts, truncation, retries, validation, confidence thresholds, and database writes behind one interface. The Worker handler only needs to know when to call it.

Do not give this classifier tools. Email subject and body are hostile, sender-controlled input and may contain prompt-injection text. Delimit them as data, cap their length, use a strict schema, reject unknown label IDs, and treat invalid output as a failed enrichment.

### 2. DraftComposer

External interface:

    draftMessage({
      replyToMessageId,
      to,
      subject,
      instruction,
      tone
    }) -> {
      subject,
      text
    }

The Vercel endpoint authenticates the user, fetches the reply/thread context server-side, adds a small amount of personal writing context, and returns a draft. It never calls Resend. The existing composer shows the draft, and the user explicitly inserts, edits, and sends it through the existing send route.

For personal style, start with a few recent sent messages or a short editable writing profile. Do not fine-tune a model for one user until prompt-plus-examples has been measured and found inadequate.

### Provider implementation

Start with one concrete OpenAI implementation. A provider interface with only one adapter would be a hypothetical seam and would add ceremony without leverage. Keep model IDs and prompt versions in configuration, and extract an adapter only when a second provider is genuinely used.

## Auto-tagging options

| Option | Accuracy | Cost | Work | Notes |
| --- | --- | --- | --- | --- |
| Rules only | High for known senders, low for nuance | None | Low | Domain/sender/subject rules are deterministic and useful for receipts, newsletters, alerts, and trusted contacts. |
| Embedding similarity | Medium | Very low | Medium | Cookie already has message vectors. Label descriptions could be embedded and compared, but thresholds need tuning and labels may overlap. |
| LLM classification | High | Low at personal-mail volume | Low to medium | Send allowed label IDs, names, and descriptions and require structured output. Never let the model silently invent labels. |
| Hybrid | Highest practical reliability | Low | Medium | Apply explicit rules first, use the LLM for unresolved messages, and keep confidence/provenance. This is the recommended end state. |

Recommended first version:

1. Give each desired label a useful description in the existing settings UI.
2. Send label IDs, names, and descriptions with the email excerpt.
3. Allow zero to three labels per email.
4. Store confidence and source.
5. Never remove a manual label during AI reprocessing.
6. Add a per-label “Auto-apply” switch later only if control is needed.

## Spam detection options

Spam is a classification problem with a higher cost of false positives than ordinary tagging.

| Option | Strength | Weakness |
| --- | --- | --- |
| Header and sender rules | Deterministic and cheap | Misses novel spam and needs authentication-result headers to be preserved. |
| LLM-only spam score | Understands content and intent | Can be manipulated by email text and can confidently misclassify. |
| Hosted spam product | Strong specialised signals | Usually aimed at organisations or mail gateways and adds another vendor/integration. |
| Self-hosted Rspamd/SpamAssassin | Mature and private | Requires an always-on server and does not fit naturally inside a Cloudflare Worker. |
| Rules plus structured LLM classification | Good personal-app balance | Still needs feedback and conservative thresholds. |

Recommended behaviour:

- Never delete or reject mail based on AI.
- Write spam, not-spam, or review plus a zero-to-one score.
- Auto-move only above a conservative threshold such as 0.98.
- Put borderline mail in the inbox with a warning or review label.
- “Not spam” should restore the message and optionally allow-list that sender.
- Keep model reasons short and machine-oriented; do not display them as authoritative security facts.
- Do not use a safety moderation endpoint as a spam classifier. Harmful-content moderation and unsolicited-email detection are different tasks.

## AI compose options

| Version | Context | Quality | Privacy/cost |
| --- | --- | --- | --- |
| Prompt only | Recipient, subject, instruction | Useful for new messages | Least data leaves the app. |
| Reply-aware | Current email or thread plus instruction | Best first release | Sends only the selected conversation. |
| Style-aware | Reply context plus a few recent sent examples | More personal voice | Sends additional personal mail excerpts. |
| Mailbox-aware RAG | Reply context plus retrieved related messages | Best for factual replies | More moving parts; reuse existing hybrid retrieval. |
| Fine-tuned model | Training set of sent mail | Potentially consistent style | Unnecessary cost, evaluation, and data lifecycle for one user. |

Start with reply-aware compose. Add an explicit checkbox or setting before including related mailbox context, and show a clear “AI-generated draft” state. Preserve the existing user-review-before-send flow.

## Runtime placement options

### Option A — Extend the existing Worker waitUntil path

**Recommendation for the first release.**

After a successful insert and after forwarding has been protected, run one MessageEnricher call in ctx.waitUntil. This is the smallest change because inbound embedding already runs there.

Advantages:

- No new runtime or message broker.
- Near-real-time tags and spam status.
- Reuses the parsed email, Hyperdrive connection, OpenAI secret, Sentry setup, and existing tests.

Trade-offs:

- Cloudflare documents a 30-second post-invocation limit for waitUntil work.
- It is best-effort, so a failure needs an explicit pending/failed state and repair job.
- Multiple model calls should be combined into one enrichment call.

### Option B — Cloudflare Queue producer and consumer

**Best reliability upgrade, but not necessary on day one for one user.**

The email Worker publishes only messageId after storage. A consumer Worker loads the message, enriches it, and acknowledges the queue item. Cloudflare Queues provides at-least-once delivery, retries, batching, and dead-letter queues, so writes must be idempotent.

Advantages:

- AI latency cannot affect mail handling.
- Durable retries and a visible backlog.
- Easy to batch or rate-limit provider calls.

Trade-offs:

- More Cloudflare configuration, a consumer handler, DLQ monitoring, and deployment tests.
- At-least-once delivery means the enrichment write must safely repeat.

### Option C — Internal Vercel enrichment endpoint

The Worker calls a secret-protected Vercel endpoint with messageId, and Vercel owns all model calls.

Advantages:

- All prompts and provider configuration live in Cookie-Web.
- The OpenAI key can be removed from the inbound Worker if embeddings also move.

Trade-offs:

- Adds internal HTTP authentication and couples email ingestion to the web deployment.
- Still needs a retry/backfill mechanism.
- Less direct than using the data and AI path already present in the Worker.

### Option D — Supabase Edge Function and Supabase Queue

A database insert enqueues messageId; an Edge Function consumes and enriches it. Supabase Queues is Postgres-native and durable.

Advantages:

- AI state and queue state live beside the data.
- Good monitoring and replay story.

Trade-offs:

- Introduces a third application runtime and Deno-specific deployment path.
- Duplicates infrastructure already available in Cloudflare.
- A database trigger should enqueue only; it should never wait on a model API call.

### Option E — Scheduled batch only

A daily or hourly job processes all messages where AI status is missing.

Advantages:

- Very simple and can use the existing backfill workflow pattern.
- Batch provider pricing may be cheaper.

Trade-offs:

- Tags and spam decisions are delayed.
- Vercel Hobby cron scheduling is daily and imprecise; GitHub Actions also is not a low-latency queue.

Use this as repair and reprocessing, not the primary experience.

### Option F — Browser or local-only inference

Calling a provider directly from Vue would expose the provider key and should not be used. Running Ollama or another local model protects content from hosted model providers, but Vercel and Cloudflare need a secure, always-on route to the machine. It is only attractive if maximum privacy is worth operating a local inference service.

## Data model

A focused migration can add:

    message_ai
      message_id        primary key, references messages
      status            pending | completed | failed
      spam_verdict      inbox | spam | review
      spam_score
      summary
      priority
      provider
      model
      prompt_version
      processed_at
      error_code

And extend message_labels with:

    source             manual | ai | rule
    confidence
    model
    prompt_version
    created_at

Important invariants:

- Manual labels win. Reprocessing may replace only AI-created assignments.
- Enrichment is idempotent by message ID and prompt version.
- Inbox list queries exclude only confirmed spam, not pending or failed messages.
- A failed AI call never makes an email disappear.
- Model/prompt provenance is retained so a model change can be evaluated and replayed.
- Store small status and output fields, not raw prompts or full provider responses.

For a one-user app, user-level allow/block lists and a writing profile can live in the existing users.settings JSONB initially. Separate tables are only needed once the data needs independent querying or history.

## Provider options

### OpenAI — recommended initial provider

Cookie already uses text-embedding-3-small and OpenAI chat completion, so this has the least integration and operational cost. OpenAI’s current model guide positions GPT-5.6 Luna for cost-sensitive, high-volume work and Terra as the quality/cost balance. Start by evaluating Luna for structured classification and drafting; use Terra for compose only if the personal test set shows a material quality gain.

Use structured outputs for enrichment and set Responses API storage deliberately. OpenAI states that API data is not used for training by default, while standard abuse-monitoring logs may retain customer content for up to 30 days. The Responses API also has application-state retention by default unless storage is disabled or stronger approved controls apply.

Official references:

- [OpenAI model selection and current pricing](https://developers.openai.com/api/docs/models)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [API data controls and retention](https://developers.openai.com/api/docs/guides/your-data)
- [text-embedding-3-small pricing and capabilities](https://developers.openai.com/api/docs/models/text-embedding-3-small)

### Cloudflare Workers AI

This is attractive for inbound classification because inference is native to the Worker runtime and includes a daily free allocation. It removes an outbound model API key from that path.

The trade-off is a split provider stack: OpenAI still supplies the existing vectors and possibly compose, while Workers AI supplies classification. Model quality and JSON-schema behaviour must be evaluated before switching.

Official references:

- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare waitUntil lifecycle](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [Cloudflare Queues overview](https://developers.cloudflare.com/queues/)

### Google Gemini

Gemini supports structured output and offers low-cost models. Its paid API tier states that data is not used to improve Google’s products; the free tier does use data for product improvement. For personal email, use a paid project if choosing this option.

It would be a new provider and the current “Gemini” UI label should not be treated as an existing integration.

Official references:

- [Gemini API pricing and data-use distinction](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

### Anthropic Claude

Claude is a strong compose-only alternative where writing quality matters. It does not replace the existing OpenAI embedding path, so it creates a two-provider setup and should be adopted only after side-by-side draft evaluation.

Official reference:

- [Anthropic API pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)

### Local or self-hosted models

Ollama or a dedicated open-model server gives the most control over where email content is processed and removes per-token provider billing. The practical cost is an always-on machine, secure remote access, model updates, monitoring, and weaker serverless availability. It is not the simplest choice for the current stack.

Official reference:

- [Ollama API documentation](https://docs.ollama.com/api)

## Approximate personal-use cost

At the OpenAI prices published on 13 July 2026, a rough GPT-5.6 Luna example is:

- 50 inbound emails per day
- 1,500 input tokens and 100 output tokens per enrichment
- Approximately 2.25 million input tokens and 150,000 output tokens per 30-day month
- At $1 per million input tokens and $6 per million output tokens: about **$3.15 per month**

Drafting a few replies per day would add little at this scale. Existing text-embedding-3-small usage is $0.02 per million tokens, so embeddings are a tiny fraction of the total.

Actual cost depends mostly on email body truncation, volume, and whether classification is one combined call. Record provider usage metadata and set a monthly budget alert rather than relying on this snapshot.

## Privacy and safety guardrails

- Keep all provider keys in Worker or Vercel secrets, never VITE_ variables or browser code.
- Send the minimum context required for the feature.
- Treat every email as untrusted input; no tools or side effects are available to the classifier.
- Use strict structured output plus local validation for spam and tags.
- Never allow AI to send, delete, or permanently reject an email.
- Redact email bodies, prompts, API keys, and database URLs from Sentry and logs.
- Keep rate limits even though the app has one user; leaked access tokens and UI loops still happen.
- Store provider, model, prompt version, latency, token usage, and outcome without storing full prompts.
- Create a small private evaluation set with normal mail, newsletters, receipts, phishing, and deliberately adversarial prompt-injection emails.

## Suggested delivery plan

### Phase 1 — useful, low-infrastructure release

1. Add the message_ai state and message-label provenance migration.
2. Implement MessageEnricher in Cookie-Worker using one structured OpenAI call.
3. Run it in the existing waitUntil path after successful storage and protected forwarding.
4. Add a protected backfill command for pending/failed rows.
5. Add Spam and AI status/filtering in Cookie-Web.
6. Replace the fixed draft animation with authenticated POST /api/compose.
7. Rename provider-specific “Gemini” identifiers and labels to “Cookie AI”.
8. Add unit tests, injection cases, and a small evaluation fixture set.

### Phase 2 — learn from personal feedback

1. Add Not spam, always trust sender, and remove AI label feedback.
2. Add rules for repeated senders and skip the model when a rule is decisive.
3. Add a small editable writing profile and reply-thread context.
4. Measure false positives, label acceptance, draft insertion, and draft-edit distance.

### Phase 3 — only when justified

1. Move enrichment to Cloudflare Queues if repair jobs are firing or calls approach waitUntil limits.
2. Evaluate a second provider on the same private test set.
3. Add embedding-based label shortlisting if the number of labels grows.
4. Consider style fine-tuning only if examples and prompting cannot meet the quality target.

## Decision

For this application and one user:

- **Use Cloudflare Worker waitUntil for background enrichment now.**
- **Use Vercel functions for interactive compose and existing Q&A.**
- **Use Supabase as the source of truth for AI state, labels, feedback, and provenance.**
- **Stay with OpenAI initially, using a low-cost current model and structured output.**
- **Keep forwarding, inbox visibility, and sending independent from AI success.**
- **Add a queue only after reliability evidence says the extra infrastructure earns its keep.**

This gives the shortest path to real value while preserving clean seams: ingestion owns arrival-time facts, the authenticated web layer owns user-requested drafts, and the database owns durable state.
