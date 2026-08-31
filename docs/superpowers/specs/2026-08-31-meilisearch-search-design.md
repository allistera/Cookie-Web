# Meilisearch Search Design

**Status:** Approved, not yet implemented
**Supersedes:** the pgvector retrieval path for both documents and messages

## Problem

Search and AI answering retrieve through three legs fused by reciprocal rank:
a Postgres keyword leg, a recency leg, and a pgvector leg over embeddings the
app generates itself. Meilisearch Cloud was introduced for the message keyword
leg only, so today two engines run side by side and neither owns retrieval.

Generating our own embeddings carries a standing cost. Every save embeds
inline, best-effort: `documents.js` states that a failure "just means
embedding/embedding_model are omitted from this save". A document that misses
its embedding is invisible to `documentRetrieval.vectorLeg`, which filters on
`d.embedding IS NOT NULL`, and stays invisible until a weekly GitHub workflow
repairs it. That workflow is the only self-heal documents have, and its last
run failed on a transient `OpenAI embeddings API responded 520` with no retry,
costing a full week of repair.

## Goal

Meilisearch owns retrieval for both documents and messages, using its own
`openAi` embedder so the app stops generating, storing and repairing
embeddings.

## Decisions

| Decision      | Choice                                                           |
| ------------- | ---------------------------------------------------------------- |
| Engine        | Meilisearch hybrid search; pgvector retired                      |
| Embedding     | Meilisearch's `openAi` embedder — the app embeds nothing         |
| Model         | `text-embedding-3-small`, 1536 dimensions — unchanged from today |
| Indexes       | Two: existing `messages`, new `documents`                        |
| Availability  | Meilisearch is required; there is no Postgres fallback           |
| Scope         | Documents and messages in one migration                          |
| Cutover       | Phased: index, backfill, switch reads, soak, then delete         |
| `from:`/`to:` | Exact match rather than substring                                |
| `in:`         | A Meilisearch filter over existing filterable attributes         |
| Drift repair  | A watermark sweep replaces the embedding backfill                |

Deliberately excluded:

- **A combined messages+documents index.** Their searchable and filterable
  attributes barely overlap, ranking would blur for both, and cross-type
  search is not a requested feature.
- **Meilisearch's `containsFilter`.** It would preserve substring `from:`
  semantics but is experimental; exact match is a smaller, explainable change.
- **A Postgres fallback.** Chosen against deliberately — see Availability.

## Availability

Meilisearch becomes a hard dependency. When it is unavailable, document
search, message search and Ask return an error rather than degrading. This is
a deliberate trade: one code path instead of two, at the cost of an outage
taking search out entirely.

Dev and CI are unaffected. `/__e2e__/search-api` in `vite.config.js` fixtures
the search Worker wholesale, so e2e never reaches Meilisearch. This cuts both
ways and is stated again under Testing.

## Architecture

`shared/meili.js` is message-shaped throughout: `DEFAULT_INDEX = 'messages'`,
`buildMeiliDocument(message)`, and a `configureMeiliIndex(env)` with messages'
attributes hardcoded. Adding documents through it would mean threading a
second shape past functions that assume the first. It splits:

- **`shared/meili.js`** — client, and generic `addDocuments`,
  `deleteDocuments` and `search` taking an index descriptor.
- **`shared/meili/messages.js`** — messages' settings, field mapping and
  embedder template.
- **`shared/meili/documents.js`** — the same for documents.

One place knows how to talk to Meilisearch; one small file per index knows
what a row looks like.

### Embedder

Both indexes carry the same embedder settings:

```json
{
  "source": "openAi",
  "model": "text-embedding-3-small",
  "dimensions": 1536,
  "apiKey": "<OpenAI key>",
  "documentTemplate": "<Liquid template over indexed fields>"
}
```

The template is the load-bearing part. Today the app decides exactly what is
embedded — `flattenBlocksToText` for documents, subject and body for messages.
Meilisearch instead renders a Liquid template over the indexed fields, so the
template must reproduce that intent and every field it references must be
present in the index.

**The OpenAI key moves into Meilisearch Cloud's index settings**, because
Meilisearch calls OpenAI directly. That is a new location for a live key and
is accepted as part of this design.

### `documents` index attributes

Derived from what `documentRetrieval.js` reads today (`d.id`, `d.user_id`,
`d.title`, `d.tags`, `d.starred`, `d.updated_at`) plus the flattened body that
`flattenBlocksToText` already produces for `content_text`:

- **Searchable:** `title`, `content_text`, `tags`
- **Filterable:** `user_id`, `tags`, `starred`, `updated_at`
- **Sortable:** `updated_at`
- **Primary key:** `id`
- **Embedder template:** title and `content_text`, matching what the app
  embeds today. `tags` are searchable but excluded from the template, so a
  tag never dilutes the semantic vector for the body.

`user_id` must be filterable and applied on every query. It is the only thing
separating one person's documents from another's once retrieval leaves
Postgres, where the `WHERE d.user_id = ...` clause did that work.

### `semanticRatio`

Starts at **0.5**, an even blend, and is a tunable rather than a constant: it
lives in one place per index so the soak can move it without a code change
elsewhere. Two anchors for tuning — 0.0 is keyword-only, matching the old
Postgres keyword leg; 1.0 is semantic-only, matching the old vector leg.

## Write path

Documents sync from `cookie-web-tasks/src/documents.js` on create, update and
delete, mirroring `meiliSync.js` in the ingest worker. Messages already sync
and only gain the fields the embedder template needs.

A save must not block on the sync succeeding, so sync failure is possible and
must be repairable — see Drift repair.

## Read path

Both query paths collapse to a single Meilisearch call with
`hybrid: { embedder, semanticRatio }`. Meilisearch embeds the query, so the
`embedTextCached` call disappears from the query side, and Meilisearch blends
the keyword and semantic signals, so reciprocal rank fusion disappears with
it. `semanticRatio` becomes the dial that `fuseRankings` weights used to be.

Structured filters (`tag:`, `is:starred`, dates) become Meilisearch filter
expressions. A search with no text sorts by `updated_at`, which removes the
need for a separate recency leg.

### `from:`, `to:` and `in:`

`meiliCanHandle()` exists today precisely because these three cannot be
expressed in Meilisearch: they need substring and folder predicates, so they
route to Postgres. With Postgres gone they need an answer.

- **`from:` and `to:` become exact matches.** `from:bob@example.com` rather
  than `from:bob`. A behaviour change, and a visible one, but explainable and
  free of an experimental dependency.
- **`in:` becomes a filter** over `is_archived`, `is_sent` and `is_deleted`,
  which are already filterable attributes on the messages index.

## Drift repair

Retiring the embedding backfill does not retire the need for self-healing. A
failed save-time embed used to leave `embedding IS NULL`; a failed Meilisearch
sync leaves a row that exists in Postgres and cannot be found. The same
failure in different clothes.

Both `documents` and `messages` gain a `search_indexed_at timestamptz`
column. The existing weekly workflow is repointed: instead of embedding rows
with a NULL vector, it re-pushes rows where `updated_at > search_indexed_at`.
Same schedule, same slot, different job.

The workflow should also gain the retry its last failure showed it needs.

## Rollout

Each step is reversible until the last.

1. Add the `documents` index and the embedder block to both indexes.
2. Backfill both corpora. Meilisearch embeds everything here, so this is the
   slow and costly step: run once, watch the task queue, confirm document
   counts match Postgres.
3. Switch document search to hybrid — lower traffic, and the half with no
   self-heal today.
4. Switch message search and Ask.
5. Soak and compare.
6. Phase 2: delete.

### Comparing during the soak

Keeping the old legs in the tree is worthless unless something exercises
them, so phase 1 keeps the Postgres retrieval reachable behind an explicit
`?engine=postgres` on the search endpoints. Not a fallback and never
automatic: a comparison handle, so the same query can be run both ways and
judged. It is deleted in phase 2.

This is the whole reason for phasing. With `source: "openAi"` the app never
sees the vectors, so once the columns are dropped there is nothing to compare
against — and this migration changes _what gets found_, not merely where it
is stored.

### Phase 2 deletes

`embedding` and `embedding_model` from both tables; `shared/embeddings.js`;
the save-time embed in `documents.js` and `outbound.js`; the embedding branch
of the ingest worker's `recoverPendingEnrichment`; `vectorLeg`, `keywordLeg`,
`recencyLeg` and `fuseRankings`; `meiliCanHandle`; both backfill scripts; and
the `?engine=postgres` handle.

### Rollback

Before step 5, revert the query paths — the columns are still populated.
After phase 2, rollback means re-embedding the corpus through Meilisearch
again. Phase 2 is the one-way door and waits until results have been compared.

## Testing

Worker unit tests get a mock Meilisearch client shaped like `createMockSql`,
asserting the query, filters and `semanticRatio` sent — not Meilisearch's own
behaviour.

**The e2e suite will not catch a Meilisearch regression.** `/__e2e__/search-api`
fixtures the search Worker wholesale, which is what keeps dev and CI free of a
Meilisearch dependency, and is also why the mock tests are the only automated
guard. Retrieval quality is judged by hand during the soak, through
`?engine=postgres`.

## Risks

| Risk                                              | Mitigation                                                 |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Retrieval quality changes in either direction     | `?engine=postgres` comparison during soak, before deletion |
| Meilisearch outage takes search and Ask down      | Accepted; see Availability                                 |
| Backfill embedding cost is unknown until measured | Run once, observe, before switching reads                  |
| `from:`/`to:` semantics change under users        | Exact match documented; surfaced in the search UI copy     |
| A sync failure hides a row indefinitely           | `search_indexed_at` watermark sweep                        |
