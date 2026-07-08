# SPEC: mail-app-ingest — Cloudflare Email Worker (capture → Neon → forward)

> **Status:** This spec describes the **complete v1 implementation** as it shipped inside
> Cookie-Web (built and hardened through July 2026, including the SRE review fixes).
> The worker is moving to its own dedicated repository; this document is sufficient to
> rebuild it there 1:1. The reference implementation lives in Cookie-Web git history at
> `workers/mail-app-ingest/` (last present at the commit that precedes its removal;
> see commits `85b6157`, `7c01b73`, `cbcf823`, `aca0d8d`).

---

## 1. Objective

A Cloudflare **Email Worker** bound to the domain's **catch-all** Email Routing rule. For
every inbound message it:

1. Parses the raw MIME with `postal-mime`.
2. Persists the message into the app's **existing** Neon Postgres tables
   (`threads` / `messages` / `attachments`) against the single owner user.
3. Forwards the original message to a verified destination address.

**Forwarding always wins.** Any parse/storage failure is logged and the mail is forwarded
anyway. A storage failure must never block, reject, or delay delivery.

## 2. Runtime & stack

- Cloudflare Workers, **plain JavaScript** (ESM, `"type": "module"`), no TypeScript source —
  types are checked via `tsc` over JSDoc/`checkJs` (`jsconfig.json`, `strict: true`,
  `noImplicitAny: false`, `types: ["@cloudflare/workers-types"]`, target/lib ES2024).
- Dependencies: `@neondatabase/serverless` ^1.1.0 (HTTP driver — Workers can't open raw TCP;
  no Hyperdrive in v1), `postal-mime` ^2.7.5.
- Dev dependencies: `wrangler` ^4.x, `vitest` ^4.x, `eslint` ^10 (flat config), `typescript` ^6,
  `@cloudflare/workers-types`, `globals`.
- `package.json` scripts: `dev` (wrangler dev), `test` (vitest run), `typecheck`
  (`tsc -p jsconfig.json`), `lint` (`eslint .`), `deploy` (`wrangler deploy`).

## 3. Repo layout (dedicated repo — worker at root)

```
src/
  index.js          # email() handler: budget, oversize guard, redaction, forward
  parse.js          # postal-mime → normalized record; all input bounds live here
  store.js          # lookup + transactional insert into existing tables
  synthetic-id.js   # deterministic Message-ID for mail lacking one
test/
  handler.test.js   parse.test.js   store.test.js   synthetic-id.test.js
  helpers.js        # fakeMessage(), createMockSql(), readFixture()
  fixtures/         # simple.eml, html-only.eml, attachments.eml,
                    # inline-image.eml, no-message-id.eml  (each with Message-ID
                    # except no-message-id.eml; local dev endpoint needs one)
wrangler.jsonc      # config below
.dev.vars.example   # DATABASE_URL placeholder only
.gitignore          # .dev.vars, .wrangler/, node_modules/
jsconfig.json  vitest.config.js  eslint.config.js  package.json
RUNBOOK.md          # ops doc (deploy, routing setup, logs, rollback, local dev)
.github/workflows/ci.yml   # test job on push/PR; deploy job on manual dispatch only
```

## 4. Configuration & secrets

`wrangler.jsonc`:

```jsonc
{
  "name": "mail-app-ingest",
  "main": "src/index.js",
  "compatibility_date": "2026-07-07",        // or newer at rebuild time
  "upload_source_maps": true,
  "observability": { "enabled": true },
  "vars": {
    // Must be a verified destination address in Cloudflare Email Routing.
    "FORWARD_TO": "allisteraall@gmail.com",
    // Inbound mail is stored against the users row with this email.
    // users.email holds the Auth0 login identity, NOT the forward address.
    "OWNER_EMAIL": "me@allisterantosik.com"
  }
}
```

- `DATABASE_URL` is the only secret: `.dev.vars` locally (never committed;
  `.dev.vars.example` carries a placeholder), `wrangler secret put` / CI `secrets:` in prod.
- No `nodejs_compat` flag is required by the neon HTTP driver as used here.
- Dev/test must use a dedicated Neon branch (`vercel-dev`), never production.

## 5. Handler flow (`src/index.js`)

Constants:

- `STORE_BUDGET_MS = 5000` — the store step gets this long, then mail is forwarded regardless.
- `MAX_PARSE_BYTES = 10 * 1024 * 1024` — postal-mime buffers/decodes the whole message
  before `forward()` is reached; near the platform message-size limit that risks an isolate
  OOM no try/catch can save. Past this size, **skip parse+store entirely** (log
  `store_skipped_oversize` with `raw_size`) and forward.

Flow of `async email(message, env, ctx)`:

1. Oversize guard (above), then forward and return.
2. `parseEmail(message)` → normalized record.
3. `neon(env.DATABASE_URL)` — wrap construction in try/catch and rethrow a generic
   `'DATABASE_URL is not a valid connection string'`: neon's own errors can embed the full
   connection string and it must never reach a log line.
4. `storeEmail(sql, record, env.OWNER_EMAIL)` raced against the budget via
   `withTimeout(promise, ms)` (Promise.race with a timer, `finally(clearTimeout)`).
5. On success log JSON `{event:'stored', outcome, message_id, raw_size, attachments, truncated}`.
6. On any error: log JSON `{event:'store_failed', error, message_id, raw_size}` where
   `error` is passed through `redact(err, env.DATABASE_URL)` (splits on the secret, joins
   with `[redacted]`). Never log bodies, subjects, or connection strings.
   **Never call `setReject()` for a storage failure.**
   If the store promise exists (i.e. the failure was the budget timeout, not parse), hand it
   to `ctx.waitUntil(...)` — a store that merely outran the budget may still succeed; log
   `{event:'stored_late', outcome, message_id}` if it does, swallow its rejection.
7. `await message.forward(env.FORWARD_TO)` — **outside** the try/catch. Forward errors
   propagate: the sending MTA sees a temporary failure and retries; idempotent storage
   makes the retry safe.

## 6. Parsing (`src/parse.js`)

`parseEmail(message)` takes a `ForwardableEmailMessage` (or a test fake with `{from, to,
raw, rawSize}`), runs `PostalMime.parse(message.raw)`, and returns the normalized record
consumed by `storeEmail`. All attacker-controlled input is bounded:

| Bound | Value | Why |
|---|---|---|
| `BODY_CAP_BYTES` | 512 KB per body (text and html separately) | rows stay small; `truncated` flag set if either was cut |
| `SNIPPET_LENGTH` | 100 chars (collapsed whitespace + `...`) | list-row snippet |
| `MAX_HEADERS` | 100 entries | jsonb bloat |
| `MAX_HEADER_VALUE` | 2048 chars per value | jsonb bloat |
| `MAX_ATTACHMENTS_META` | 100 | jsonb/row bloat |
| `MAX_REFERENCES` | 50 message-ids | thread-lookup `ANY()` array |
| `MAX_MESSAGE_ID` | 998 chars | btree index tuples cap ~2.7 KB; RFC 5322 line limit |
| `MAX_FUTURE_MS` | 24 h | a spoofed far-future Date would pin its thread atop the inbox via `last_message_at` — clamp to now |

Rules:

- **NUL stripping:** Postgres text/jsonb reject U+0000 — `stripNul()` every string
  (subject, bodies, names, header keys/values, filenames, message-id).
- **Body capping:** byte-accurate via TextEncoder; after slicing, strip a possible partial
  trailing code point (`replace(/�+$/, '')`).
- **HTML-only mail:** `htmlToText(html)` derives `body_text` (strip style/script blocks,
  `<br>`→`\n`, block-close tags→`\n\n`, strip tags, decode the common entities
  `&nbsp; &amp; &lt; &gt; &#39;/&apos; &quot;`, collapse whitespace). `body_text` drives both
  UI rendering and the `messages.search` tsvector, so it must never be null when the message
  had content.
- **Message-ID:** use the header if present and ≤ `MAX_MESSAGE_ID`; otherwise
  `syntheticMessageId({from, to, date, subject, bodyPrefix: first 1024 chars of text||html})`.
- **Synthetic ID** (`src/synthetic-id.js`): SHA-256 over the parts joined with `|`
  (null → empty string), hex-encoded → `<synthetic-<hex>@mail-app-ingest>`. Deterministic so
  MTA retries of Message-ID-less mail still dedupe.
- **sent_at:** parsed Date header if valid, else now; clamp future dates past 24 h to now.
- **Addresses:** postal-mime entries are mailboxes `{name, address}` or groups
  `{name, group:[...]}` — flatten groups recursively. `from_address` is NOT NULL in the
  schema; fall back to the envelope sender (`message.from`) when the From header is
  unparseable.
- **recipients** jsonb: `{to: [...], cc: [...], bcc: [...]}` of `{name, address}`.
- **headers** jsonb: `[{key, value}]`, bounded as above.
- **attachments:** metadata only — `{filename, mime_type, size}`; size is `byteLength` for
  binary content, `.length` for string parts (approximate is fine). Filenames may be null
  (inline images, calendar invites). **R2 blob upload is the future hook point here.**
- **envelope_from / envelope_to:** `message.from` / `message.to` (SMTP envelope; differs
  from the From header on bounces/lists, and records which catch-all address was hit).
- `rawSize` = `message.rawSize`.

## 7. Storage (`src/store.js`)

`storeEmail(sql, record, ownerEmail)` → `'inserted' | 'duplicate'`; throws on any failure
(caller logs + forwards regardless).

The neon HTTP driver has **no interactive transactions**, so the flow is one lookup SELECT
followed by one `sql.transaction([...])` batch built with client-generated
`crypto.randomUUID()` ids:

1. **Lookup (single SELECT):** against `users WHERE email = ownerEmail ORDER BY created_at
   LIMIT 1`, returning:
   - `user_id`
   - `is_duplicate`: `EXISTS (messages WHERE user_id AND message_id = record.messageId)`
   - `thread_id`: latest (`ORDER BY sent_at DESC LIMIT 1`) thread of any message whose
     `message_id = ANY(record.references)` — attaches replies to existing threads via
     In-Reply-To/References.

   No users row → throw `'no users row matches OWNER_EMAIL; message not stored'`.
   Duplicate → return `'duplicate'` without writing.

2. **Transaction batch:**
   - If no thread matched: `INSERT INTO threads (id, user_id, subject, last_message_at)`
     (fresh thread; `message_count` defaults to 1).
   - `INSERT INTO messages (id, thread_id, user_id, from_name, from_address, recipients,
     subject, snippet, body_text, body_html, sent_at, message_id, headers, raw_size,
     truncated, envelope_from, envelope_to)` with
     `ON CONFLICT (user_id, message_id) WHERE message_id IS NOT NULL DO NOTHING`.
     jsonb params passed as `${JSON.stringify(...)}::jsonb`; `sent_at` as ISO string.
   - Per attachment: `INSERT INTO attachments (id, message_id, filename, content_type,
     size_bytes, blob_url)` with `blob_url = null` (metadata only until R2).
     If the message insert was a conflict no-op, these FK inserts fail and roll the whole
     batch back — the retry is then a clean duplicate.
   - If a thread matched: bump counters —
     `UPDATE threads SET message_count = message_count + 1, last_message_at =
     GREATEST(last_message_at, sent_at) WHERE id = thread AND EXISTS (SELECT 1 FROM messages
     WHERE id = messageUuid)` — the EXISTS guard keeps counters from drifting when the
     message INSERT no-opped under a concurrent retry.

**Race caveat (accepted):** a concurrent MTA retry slipping between lookup and transaction
is still blocked by the unique index; worst case is an orphan `threads` row, which the UI
never renders.

## 8. Database contract (lives in the Cookie-Web repo)

The worker owns **no schema**. It writes to Cookie-Web's existing tables; the enabling
migrations are already applied in production and remain in Cookie-Web's `migrations/`
(tracked in `schema_migrations`, applied by its `migrate.yml` workflow):

- `0003_inbound_email_fields.sql` — adds to `messages`: `message_id text`, `headers jsonb`,
  `body_html text`, `raw_size integer`, `truncated boolean NOT NULL DEFAULT false`,
  `envelope_from text`, `envelope_to text`; creates
  `CREATE UNIQUE INDEX messages_user_message_id_key ON messages (user_id, message_id)
  WHERE message_id IS NOT NULL`; makes `attachments.blob_url` nullable.
- `0004_relax_attachment_filename.sql` — makes `attachments.filename` nullable.

Base columns used (from `0001_initial_email_schema.sql`): `users(id, email, created_at)`;
`threads(id, user_id, subject, last_message_at, message_count)`; `messages(id, thread_id,
user_id, from_name, from_address NOT NULL, recipients jsonb, subject, snippet, body_text,
sent_at, …)`; `attachments(id, message_id FK, filename, content_type, size_bytes, blob_url)`.
`messages.search` is a generated tsvector over subject + body_text.

**Any future schema change stays in Cookie-Web's `migrations/`** (additive SQL files);
the worker repo only documents the contract.

## 9. Logging contract

All log lines are single JSON objects. Events: `stored` (`outcome`, `message_id`,
`raw_size`, `attachments`, `truncated`), `store_failed` (`error` — secret-redacted,
`message_id`, `raw_size`), `stored_late` (`outcome`, `message_id`),
`store_skipped_oversize` (`raw_size`). Bodies, subjects, and connection strings are never
logged. Tail with `npx wrangler tail mail-app-ingest`.

## 10. Tests (vitest, node environment — port all of these)

`test/helpers.js`: `fakeMessage(raw, {from, to})` — minimal ForwardableEmailMessage stand-in
(postal-mime accepts a string for `raw`, so no ReadableStream needed); `createMockSql({lookupRows})`
— mimics the neon tagged-template client, recording executed queries and `transaction()` batches.

- **handler.test.js:** stores then forwards exactly once (happy path); still forwards when
  store throws; still forwards when store hangs past the budget; never logs message bodies
  on failure; skips parse/store for oversized messages but still forwards; never logs the
  connection string when neon() rejects the URL; redacts the connection string from
  arbitrary store errors; hands a budget-exceeding store to ctx.waitUntil instead of
  cancelling it; lets forward() failures propagate for MTA retry.
- **parse.test.js:** simple fixture → normalized record; deterministic synthetic ID when
  Message-ID missing; body_text derived from HTML-only mail; body cap + truncated flag;
  attachment metadata only; unnamed inline attachments keep null filename; strips U+0000;
  clamps far-future Date headers; replaces oversized Message-ID with synthetic hash; caps
  headers at 100 and bounds values; falls back to envelope sender on unparseable From;
  htmlToText unit cases.
- **store.test.js:** inserts new thread + message → 'inserted'; returns 'duplicate' without
  writing; reuses referenced thread and bumps counters; throws when no users row matches;
  attachment rows with null blob_url; propagates transaction failures.
- **synthetic-id.test.js:** deterministic; changes when any component changes; tolerates
  missing components.

## 11. CI/CD (GitHub Actions, adapted for the dedicated repo)

Single workflow: **test** job on push/PR to main (`npm ci`, lint, typecheck, `npm test`,
`npx wrangler deploy --dry-run`), Node 22, npm cache. **deploy** job runs **only on manual
`workflow_dispatch`**, `needs: test`, via `cloudflare/wrangler-action@v3` with repo secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit), `CLOUDFLARE_ACCOUNT_ID`, and `DATABASE_URL`
pushed to the worker through the action's `secrets:` input. No local deploys.
(In the dedicated repo, drop Cookie-Web's `paths:` filters and `working-directory`.)

## 12. Operations (RUNBOOK highlights — carry the full RUNBOOK.md over)

- **Email Routing (dashboard, one-time):** verify the destination address
  (`forward()` fails until verified); set the domain **catch-all** rule to
  "Send to a Worker" → `mail-app-ingest`.
- **Live round-trip:** mail an external message to `anything@<domain>`; expect delivery at
  the forward address, a `messages` row visible in the app inbox, and a
  `{"event":"stored","outcome":"inserted"}` tail line.
- **Rollback:** `npx wrangler rollback`, or flip the catch-all back to plain forwarding —
  mail keeps flowing with no worker in the path.
- **Local dev:** `cp .dev.vars.example .dev.vars` (Neon vercel-dev branch URL),
  `npm run dev`, then
  `curl --request POST 'http://localhost:8787/cdn-cgi/handler/email'
  --url-query 'from=sender@example.com' --url-query 'to=inbox@example.org'
  --data-binary @test/fixtures/simple.eml`
  (local endpoint requires a Message-ID header in the body). `wrangler dev` prints the
  forward call instead of forwarding. Re-POSTing the same fixture must log
  `"outcome":"duplicate"` and leave row counts unchanged.

## 13. Non-goals (v1) & known caveats

- No attachment blob storage (`blob_url` stays null — R2 is a future iteration; hook point
  is the attachment mapping in `src/parse.js`).
- No outbound/reply sending, UI, search/embeddings, or queue/retry infrastructure; no
  Hyperdrive.
- Store step is best-effort within 5 s; slower Neon calls are abandoned (mail still
  forwarded; the MTA retry usually lands the row).
- Single-owner design: mail is stored against the one `users` row matching `OWNER_EMAIL`;
  if none exists the message is forwarded but not stored.
- Rare orphan-`threads` race (see §7) — harmless, never rendered.

## 14. Ground-truth docs (fetch fresh at rebuild time; don't trust training data)

- `https://developers.cloudflare.com/email-service/llms.txt` (Email Routing now lives under
  **Email Service**; append `index.md` to any docs URL for markdown)
- Route-emails Workers API: `email()` handler, `ForwardableEmailMessage`, `forward()`,
  `setReject()`
- `https://developers.cloudflare.com/email-service/local-development/routing/index.md`
- `@neondatabase/serverless` README (HTTP driver usage in Workers)
