# Meilisearch Search — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the pgvector retrieval path now that Meilisearch serves all search, ending with dropping the embedding columns.

**Architecture:** Removal only — no new behaviour. Code stops referencing the embedding columns first, and the columns are dropped last, so every step before the final one is revertible by `git revert` alone.

**Tech Stack:** Cloudflare Workers, postgres.js, Vitest, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-08-31-meilisearch-search-design.md` — its "Phase 2 deletes" section is the authority for what goes.

## Global Constraints

- **Two repos.** `workers/`, `shared/`, `scripts/` are in `Cookie-Worker`; `migrations/`, `api/`, `.github/` here are in `Cookie-Web`.
- **Push straight to `main`** in both. No PRs.
- **Cookie-Worker gate is FIVE commands, not three:** `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, and `npm run types -- --all --check`. Phase 1 shipped a red CI twice by running only the first three. Run all five before declaring a task done.
- **Cookie-Web gate:** `npm run test:unit`, `npm run test:e2e`, `npm run format:check`, `npm run lint`, `npm run build`.
- **The columns are dropped LAST**, in Task 6, after every code reference is gone and deployed. Dropping them while code still writes them breaks writes.
- **This is a one-way door.** Once `embedding` is dropped, restoring the Postgres path means re-embedding the entire corpus. There is no rollback after Task 6.

## What must NOT be deleted

These look like part of the embedding path and are not:

- **`shared/meili/embedder.js`** — Meilisearch's own embedder settings. Deleting it un-configures hybrid search entirely.
- **`workers/cookie-web-tasks/src/documentText.js`** (`flattenBlocksToText`) — still produces `content_text`, which Meilisearch indexes and searches.
- **`scripts/reindex-meili.js`, `scripts/repair-search-drift.js`, `.github/workflows/search-drift-repair.yml`, `.github/workflows/search-reindex.yml`** (Cookie-Worker) — these are the Meilisearch operational scripts, not the embedding ones.
- **`fetchSearchEmails` / `respondWithDocuments`** — hydration, shared by nothing else now but still the only path from ids to rows.

---

### Task 1: Remove the `engine=postgres` handles and the Postgres retrieval legs

**Files:**

- Modify: `workers/cookie-web-search/src/search.js`, `workers/cookie-web-search/src/ask.js`, `workers/cookie-web-tasks/src/documents.js`
- Delete: `workers/cookie-web-search/src/retrieval.js`, `workers/cookie-web-search/src/rankFusion.js`, `workers/cookie-web-tasks/src/documentRetrieval.js`, `workers/cookie-web-tasks/src/rankFusion.js`
- Delete: the matching test files for each deleted module
- Test: `workers/cookie-web-search/test/search.test.js`, `workers/cookie-web-tasks/test/documents.test.js`

- [ ] **Step 1: Delete the engine switch in all three entry points**

In `search.js` and `documents.js` remove the line reading `url.searchParams.get('engine')` and the branch it selects; in `ask.js` remove the `body.engine === 'postgres'` branch. What remains is the Meilisearch path, called unconditionally. Delete the `searchViaPostgres` / `retrieveViaPostgres` helpers entirely.

- [ ] **Step 2: Delete the leg modules and their tests**

`retrieval.js` (`keywordLeg`, `recencyLeg`, `vectorLeg`, `folderClause`, `filterClause`), `rankFusion.js` (`fuseRankings`), `documentRetrieval.js`, and each one's test file.

**Before deleting `retrieval.js`, check whether `folderClause` or `filterClause` is imported anywhere that survives.** They encode folder semantics; `meiliMessageFilter` now owns that, but a stray importer means something still needs SQL filtering and this task is wrong.

- [ ] **Step 3: Delete the tests that exercised the removed paths**

In `search.test.js` and `documents.test.js`, remove the `engine=postgres` cases. **Do not remove tests for the Meilisearch path** — those are the ones that now cover everything.

- [ ] **Step 4: Run the full five-command gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format:check && npm run types -- --all --check`
Expected: all pass. Test count will drop; that is expected and correct.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove the Postgres retrieval legs and the engine=postgres handles"
```

---

### Task 2: Remove write-time embedding

**Files:**

- Modify: `workers/cookie-web-tasks/src/documents.js`, `workers/cookie-web-send/src/outbound.js`, `workers/cookie-web-send/src/worker.js`, `workers/mail-app-ingest/src/enrich.js`, `workers/mail-app-ingest/src/worker.js`
- Delete: `workers/cookie-web-tasks/src/embeddings.js`, `workers/mail-app-ingest/src/embed.js`, and their tests

- [ ] **Step 1: Stop writing `embedding` in documents**

In `documents.js`'s `computeSearchFields`, remove the embed call and the `fields.embedding` / `fields.embedding_model` assignments. **Keep `content_text`** — `flattenBlocksToText` stays, because Meilisearch indexes that field.

- [ ] **Step 2: Stop writing `embedding` on send**

In `cookie-web-send`, remove the `embedText` import and call in `worker.js` and the `EMBEDDING_MODEL` usage in `outbound.js`, along with the `embedding`/`embedding_model` columns from its INSERT/UPDATE statements.

- [ ] **Step 3: Stop embedding at ingest**

In `mail-app-ingest`, delete `src/embed.js` and its test, remove its use from `enrich.js`, and remove the `AND m.embedding IS NULL` clause from `recoverPendingEnrichment`'s candidate query in `worker.js` — that condition exists solely to find rows needing an embedding. Check what remains of the `ai.status = 'completed'` branch: if removing the embedding condition makes it select rows with no work to do, remove that branch too rather than leaving it re-enriching completed rows forever.

- [ ] **Step 4: Run the five-command gate, then commit**

```bash
git add -A
git commit -m "Stop generating embeddings on write"
```

---

### Task 3: Remove the shared embedding client and the legacy Meilisearch duplicates

**Files:**

- Delete: `shared/embeddings.js`
- Modify: `shared/meili.js`
- Modify: `shared/test/meili.test.js`

- [ ] **Step 1: Delete `shared/embeddings.js`**

By now nothing should import it. Verify with a grep before deleting; a remaining importer means Task 1 or 2 missed something.

- [ ] **Step 2: Delete the legacy Meilisearch surface**

From `shared/meili.js` remove `meiliCanHandle`, `meiliKeywordLeg`, `buildMeiliDocument`, `configureMeiliIndex`, `addMeiliDocuments`, `deleteMeiliDocuments` and `LEGACY_MESSAGE_FILTERABLE`. These are the pre-descriptor API, superseded by `configureIndex` / `addDocuments` / `deleteDocuments` / `hybridSearch` taking a descriptor.

**`buildMeiliDocument` is the live ingest write path** — check what `meiliSync.js` imports and repoint it at `MESSAGES_INDEX.toDocument` via `addDocuments` before deleting. This is the duplicate pair phase 1 pinned with a test; that test goes too, since after this there is only one of them.

- [ ] **Step 3: Run the five-command gate, then commit**

```bash
git add -A
git commit -m "Delete the embedding client and the pre-descriptor Meilisearch API"
```

---

### Task 4: Cookie-Web — delete the backfill scripts and workflow

**Files (all Cookie-Web):**

- Delete: `scripts/backfill-embeddings.js`, `scripts/backfill-document-embeddings.js`, `.github/workflows/backfill-embeddings.yml`, `api/_lib/embeddings.js`
- Check: `api/_lib/services.js`, `api/_lib/documentText.js` for embedding references

- [ ] **Step 1: Delete the four files**

- [ ] **Step 2: Grep for survivors**

`grep -rn "embedding\|embedText" api/ src/ scripts/ --exclude-dir=node_modules`. Anything remaining is either a comment to update or a genuine dependency this plan missed — report it rather than forcing the delete.

- [ ] **Step 3: Run the Cookie-Web gate, then commit**

Run: `npm run test:unit && npm run test:e2e && npm run format:check && npm run lint && npm run build`

```bash
git add -A
git commit -m "Delete the embedding backfill scripts and workflow"
```

---

### Task 5: Deploy, and verify nothing writes the columns

Deployment happens BEFORE the columns are dropped. If code still writing `embedding` meets a dropped column, every message insert fails.

- [ ] **Step 1: Push and deploy all Workers**

```bash
cd ~/Development/Projects/Cookie/Cookie-Worker
git push origin main
gh workflow run deploy.yml -f worker=all --ref main
```

- [ ] **Step 2: Verify search still works**

Run a document search, a message search and an Ask against production. All three must return results, not 503.

- [ ] **Step 3: Verify nothing writes the columns**

Send yourself an email and confirm it arrives and is searchable. That exercises the ingest write path, which was the last writer of `messages.embedding`.

---

### Task 6: Drop the columns — THE ONE-WAY DOOR

Do this only after Task 5 is verified in production. After this, restoring the Postgres path means re-embedding the entire corpus.

**Files:** Create `migrations/0056_drop_embeddings.sql` (Cookie-Web)

- [ ] **Step 1: Write the migration**

```sql
-- Meilisearch owns retrieval; its openAi embedder generates and stores the
-- vectors now. Nothing reads or writes these columns as of phase 2.
--
-- One-way: restoring the pgvector path means re-embedding the whole corpus.

BEGIN;

DROP INDEX IF EXISTS public.messages_embedding_idx;
DROP INDEX IF EXISTS public.documents_embedding_idx;

ALTER TABLE public.messages DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.messages DROP COLUMN IF EXISTS embedding_model;
ALTER TABLE public.documents DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.documents DROP COLUMN IF EXISTS embedding_model;

COMMIT;
```

**Index names verified:** `messages_embedding_idx` is created in `migrations/0005_message_embeddings.sql` and `documents_embedding_idx` in `migrations/0049_document_embeddings.sql` — both as written above. A wrong name in `DROP INDEX IF EXISTS` silently does nothing, so they were checked rather than guessed. Also confirm no view or generated column depends on `embedding`, which would make the DROP fail.

- [ ] **Step 2: Apply it**

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
git push origin main   # migrations/** on main triggers migrate.yml
```

- [ ] **Step 3: Confirm**

`migrate.yml` reports `apply 0056_drop_embeddings.sql`, and search still works in production.

---

## Notes for the executor

- **Deleting is the whole job.** If you find yourself adding behaviour, stop — you are out of scope.
- **Test counts will fall.** That is the point. Do not backfill tests for deleted code.
- **The Cookie-Worker gate is five commands.** Phase 1 turned CI red twice by running three.
- **Out of scope, worth a follow-up:** after this, the `search` tsvector columns and their GIN indexes (`messages`, `documents_search_idx` in 0048) are also dead — nothing queries them once `keywordLeg` is gone. The spec scopes phase 2 to the embedding columns, so they stay; raise them separately rather than widening this plan.
- **Order is load-bearing.** Code stops referencing the columns (Tasks 1-4), deploys (Task 5), and only then are the columns dropped (Task 6). Any other order breaks production writes.
