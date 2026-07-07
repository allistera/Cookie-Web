# SPEC: mail-app-ingest — Cloudflare Email Worker (capture → Neon → forward)

> **How to use this file:** Place this file in the parent directory that holds (or will hold) `workers/`, start Claude Code there, and say:
> *"Read SPEC-mail-app-ingest.md. Scaffold the project at workers/mail-app-ingest/, run Phase 0 now, then enter plan mode and stop for my approval before writing any code."*

---

## 1. Objective

Build and deploy a Cloudflare Email Worker that receives inbound mail on `<address>@<domain>`, persists the parsed message to the **existing** Neon Postgres database, and forwards the original message to `<forward-to-address>`. Mail delivery is the priority: a storage failure must never block, reject, or delay forwarding.

## 2. Context and constraints

- **Location:** create the project at `workers/mail-app-ingest/`, creating the `workers/` directory first if it does not exist. All project paths below are relative to `workers/mail-app-ingest/`.
- **Runtime:** Cloudflare Workers, TypeScript, module syntax, latest `wrangler`. Worker name follows the existing `mail-app-*` convention: `mail-app-ingest`.
- **Email Routing** is enabled on `<domain>`. A route will bind `<address>@<domain>` → this worker. Forward destinations must be verified destination addresses in Email Routing before `message.forward()` will succeed.
- **Database:** existing Neon Postgres. Connection string is provided only as the `DATABASE_URL` secret (`.dev.vars` locally, `wrangler secret put` in prod). Use the `@neondatabase/serverless` HTTP driver (`neon()` tagged-template function) — Workers cannot open raw TCP. Do not introduce Hyperdrive in v1.
- **Parsing:** `postal-mime` (Cloudflare's recommended parser for Email Workers).
- **Dev database:** use a dedicated Neon branch, never the production branch, for local dev and tests.

### Ground truth to fetch before planning (do not rely on training data)

Cloudflare publishes token-efficient markdown docs — append `index.md` to any docs URL, or use the product index:

- `https://developers.cloudflare.com/email-service/llms.txt` (product index — Email Routing docs now live under **Email Service**)
- Route-emails Workers API (`email()` handler, `ForwardableEmailMessage`, `forward()`, `setReject()`) and the `email` binding shown in current wrangler config examples
- `https://developers.cloudflare.com/email-service/local-development/routing/index.md` (local `wrangler dev` email endpoint)
- `@neondatabase/serverless` README (confirm current usage in Workers and whether `nodejs_compat` is required)

## 3. Decisions already made — do not relitigate

1. **Forward-first reliability.** Wrap the entire store step in try/catch with an internal time budget (~5s). On any storage error: log with enough context to debug, then forward anyway. Never call `setReject()` for a storage failure.
2. **Failure semantics.** If `forward()` itself throws, let the exception propagate — the sending MTA gets a temporary failure and retries. Do not swallow forwarding errors.
3. **Idempotency.** Senders retry. Unique index on `message_id`; insert with `ON CONFLICT (message_id) DO NOTHING`. Emails missing a Message-ID header get a deterministic synthetic ID (hash of from + to + date + subject + body prefix).
4. **What gets stored:** message_id, envelope from/to, subject, text body, html body, full headers as `jsonb`, attachment **metadata only** (filename, mime type, size) as `jsonb`, `raw_size`, `received_at`, `forwarded_to`, `store_status`. Bodies capped at 512 KB each with a `truncated` flag. No attachment blobs, no raw MIME in Postgres.
5. **Schema isolation.** New table(s) only (suggested: `inbound_emails`). Never alter or drop existing tables. Migrations are additive, plain SQL files in `migrations/`, applied with `psql "$DATABASE_URL" -f <file>`.
6. **Secrets** never appear in `wrangler.jsonc`, code, logs, or git. Commit `.dev.vars.example` with placeholder values only.

## 4. Non-goals (v1)

- No attachment storage (R2 is a future iteration — leave a comment where it would hook in).
- No outbound/reply sending, no UI, no search/embeddings, no queue/retry infrastructure.
- No changes to any other worker, route, or existing DB object.

## 5. Deliverables (all under `workers/mail-app-ingest/`)

- `src/` — worker with `email()` handler; parsing and storage in separate modules so they are unit-testable.
- `migrations/0001_inbound_emails.sql`
- `test/` — unit tests + fixtures (see criteria below); `fixtures/*.eml` must include a `Message-ID` header (the local dev endpoint requires one).
- `wrangler.jsonc`, `.dev.vars.example`, `package.json` scripts: `dev`, `test`, `typecheck`, `lint`, `deploy`.
- `RUNBOOK.md` — deploy steps; route binding (Email Routing rules: bind `<address>@<domain>` — or catch-all — to the action "Send to a Worker" → `mail-app-ingest`, via dashboard or the Email Routing REST API); destination-address verification; live round-trip test; log access (`wrangler tail mail-app-ingest`); rollback (`wrangler rollback`).

## 6. Success criteria — every box verified, not assumed

- [ ] `npm run typecheck`, `lint`, and `test` all pass.
- [ ] Unit tests cover: happy path (parse → insert → forward called once); DB unreachable → forward still called, error logged; duplicate message_id → single row; missing Message-ID → synthetic ID insert; oversize body → truncated flag set.
- [ ] Integration: with `wrangler dev` running, trigger the handler for each fixture, e.g. `curl --request POST 'http://localhost:8787/cdn-cgi/handler/email' --url-query 'from=sender@example.com' --url-query 'to=<address>@<domain>' --data-binary @test/fixtures/simple.eml` → row appears in the Neon **dev branch**, forward is invoked (visible in dev logs).
- [ ] Re-POST the same fixture → row count unchanged.
- [ ] With a deliberately bad `DATABASE_URL` in `.dev.vars` → forward still invoked, no unhandled exception.
- [ ] `wrangler deploy --dry-run` clean. Actual deploy only in Phase 5.

## 7. Agent plan — how I want you to work

**Phase 0 — Recon (parallel, read-only).** Launch three subagents *in parallel*; each returns a concise summary, not raw dumps:

- **docs-recon** (general-purpose): fetch the Cloudflare markdown docs and Neon driver docs listed in §2; return the exact current `email()` handler signature, `forward()` constraints, the local-dev endpoint syntax with a working curl example, and whether `nodejs_compat` is needed.
- **schema-recon** (general-purpose, read-only): connect to the Neon dev branch (`psql "$DATABASE_URL"` or the Neon MCP server if configured) and return existing tables/columns/indexes so the migration cannot collide. **SELECT/`\d` only — no writes.**
- **repo-recon** (Explore): if other `mail-app-*` worker repos are in the workspace, summarize their wrangler config, TS config, lint setup, and test conventions so this worker matches.

**Phase 1 — Plan (stop for approval).** In plan mode, propose: final schema DDL, module layout, test list, and answers to §9 open questions or explicit assumptions. **Do not write code until I approve.**

**Phase 2 — Implement.** Main agent implements. Follow repo conventions from Phase 0. Small commits per deliverable.

**Phase 3 — Verify.** Delegate test/typecheck/lint runs and the local email-endpoint integration loop to a subagent so verbose output stays out of the main context; it reports only failures with error text. Fix and re-run until §6 is green.

**Phase 4 — Review (fresh context).** Launch a code-review subagent that reads only the diff and this spec. Focus: SQL injection (parameterized queries only — header/subject values are attacker-controlled), secret leakage in logs, unbounded memory on large messages, and the §3 failure-semantics guarantees. Fix findings, re-run Phase 3.

**Phase 5 — Deploy (human gate).** Only after I explicitly confirm: `wrangler deploy`, secrets set, then walk me through route binding + destination verification, and finish `RUNBOOK.md` with the live round-trip result.

## 8. Guardrails

- Database access is read-only until the approved migration in Phase 2; only ever run migrations against the branch I name.
- Never print or log secret values; log message_id and sizes, not full bodies.
- If the local email endpoint or Neon connection fails 3 consecutive times, stop and report with diagnostics instead of iterating blindly.
- Touch nothing outside `workers/mail-app-ingest/` except the approved Neon migration.

## 9. Open questions — ask before Phase 2, don't guess

1. Exact inbound address(es): single address or catch-all on `<domain>`?
2. Forward destination(s), and are they already verified in Email Routing?
3. Which Neon branch/database for dev vs prod, and may the worker share the existing DB user or should a scoped role be created?
4. Table name preference, and should `inbound_emails` live in `public` or a dedicated schema?

---

## Appendix: optional custom subagent (reusable across mail-app-* projects)

For roles you will reuse, define them once in `.claude/agents/` instead of re-describing them per spec:

```markdown
---
name: sre-code-reviewer
description: Reviews diffs for failure semantics, security, and operability before deploy. Use proactively after implementation phases.
tools: Read, Grep, Glob, Bash
model: sonnet
---
You are a senior SRE reviewing production-bound code. For every diff:
1. Trace every failure path — what happens when each external call fails?
2. Check parameterized queries, secret handling, log hygiene, input size bounds.
3. Verify observability: can an on-call engineer debug this from logs alone?
Report findings as blocking / non-blocking with file:line references. Be critical; do not rubber-stamp.
```
