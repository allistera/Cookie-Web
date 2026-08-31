# Meilisearch Search — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meilisearch hybrid search serves document and message retrieval, with the Postgres legs still reachable behind `?engine=postgres` so results can be compared before anything is deleted.

**Architecture:** `shared/meili.js` becomes a generic client that takes an index descriptor; `shared/meili/messages.js` and `shared/meili/documents.js` each describe one index's settings, field mapping and embedder template. Both indexes gain an `openAi` embedder, so Meilisearch generates document vectors at index time and query vectors at search time. The three-leg retrieval and its rank fusion collapse into one hybrid call per query.

**Tech Stack:** Cloudflare Workers, `meilisearch` JS client, postgres.js, Vitest, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-08-31-meilisearch-search-design.md` — read it first, especially **Availability**, **`from:`, `to:` and `in:`** and **Drift repair**.

## Global Constraints

- **Two repos.** Paths starting `workers/` or `shared/` are in `Cookie-Worker`; `migrations/`, `docs/` and `.github/` here are in `Cookie-Web`. Siblings under `~/Development/Projects/Cookie/`.
- **Push straight to `main`** in both repos. No PRs.
- **Before any push to Cookie-Worker:** `npm test`, `npm run lint`, `npm run typecheck`.
- **Before any push to Cookie-Web:** `npm run test:unit`, `npm run test:e2e`, `npm run format:check`, `npm run lint` **and** `npm run build`. There is no `npm test` in that repo. `format:check` runs oxfmt **and** Prettier — `npx prettier --check` alone leaves oxfmt failures that turn CI red.
- **Model is `text-embedding-3-small`, 1536 dimensions.** Unchanged from today; do not substitute another model.
- **`semanticRatio` starts at 0.5**, defined once per index descriptor.
- **`user_id` is filtered on every Meilisearch query.** Postgres did this with `WHERE user_id = ...`; in Meilisearch it is an explicit filter, and omitting it on any path leaks one person's data to another.
- **Nothing is deleted in phase 1.** No dropped columns, no removed legs, no removed scripts. Phase 2 owns deletion.
- **Meilisearch is required at runtime**, but `meiliAvailable(env)` still gates sync so local Workers run without it.

---

## File Structure

| File                                                | Responsibility                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `shared/meili.js`                                   | Client plus generic `configureIndex`, `addDocuments`, `deleteDocuments`, `hybridSearch`, all taking a descriptor (Task 1) |
| `shared/meili/messages.js`                          | Messages: settings, `toDocument`, embedder template (Task 1)                                                              |
| `shared/meili/documents.js`                         | Documents: settings, `toDocument`, embedder template (Task 2)                                                             |
| `shared/test/meiliClient.js`                        | Mock Meilisearch client for tests (Task 1)                                                                                |
| `shared/test/meili.test.js`                         | Tests for the generic layer (Task 1)                                                                                      |
| `workers/cookie-web-tasks/src/documentMeiliSync.js` | Push/remove one document (Task 3)                                                                                         |
| `workers/cookie-web-tasks/src/documents.js`         | Sync on write; hybrid search behind the engine switch (Tasks 3, 5)                                                        |
| `workers/cookie-web-search/src/search.js`           | Hybrid search behind the engine switch (Task 6)                                                                           |
| `workers/cookie-web-search/src/ask.js`              | Retrieval via hybrid (Task 6)                                                                                             |
| `migrations/0055_search_indexed_at.sql`             | `search_indexed_at` on both tables (Task 4)                                                                               |
| `scripts/reindex-meili.js`                          | One-off backfill of both corpora (Task 7)                                                                                 |
| `.github/workflows/backfill-embeddings.yml`         | Repointed at index drift, with retry (Task 8)                                                                             |

---

### Task 1: A testable, index-agnostic Meilisearch layer

`shared/meili.js` is message-shaped throughout — `DEFAULT_INDEX = 'messages'`, `buildMeiliDocument(message)`, `configureMeiliIndex(env)` with messages' attributes hardcoded — and has **no tests at all**. Adding a second index through it means threading a second shape past functions that assume the first, so it is generalised first, with the mock that makes every later task testable.

**Files:**

- Create: `shared/meili/embedder.js`, `shared/meili/messages.js`, `shared/test/meiliClient.js`, `shared/test/meili.test.js`
- Modify: `shared/meili.js`

**Interfaces:**

- Produces:
  - `createMockMeili(responses?)` → `{ client, calls }`; `calls` records `{ index, method, args }` in order.
  - An **index descriptor**: `{ name, primaryKey, searchable, filterable, sortable, embedder, toDocument(row) }`.
  - `configureIndex(env, descriptor)` → `Promise<void>`
  - `addDocuments(env, descriptor, rows)` → `Promise<{ taskUid: number }>`
  - `deleteDocuments(env, descriptor, ids)` → `Promise<{ taskUid: number }>`
  - `hybridSearch(env, descriptor, { userId, text, filter, limit, semanticRatio })` → `Promise<{ id: string }[]>`
  - `MESSAGES_INDEX` — the messages descriptor.
- Consumes: nothing.

- [ ] **Step 1: Write the mock client**

Create `shared/test/meiliClient.js`:

```js
import { vi } from 'vitest'

/**
 * A stand-in for the Meilisearch JS client, shaped like createMockSql: it
 * records what we asked for so tests assert our query, not Meilisearch's
 * behaviour. `responses` maps a method name to the value it resolves with.
 *
 * @param {Record<string, any>} responses
 */
export function createMockMeili(responses = {}) {
  const calls = []
  const index = (name) => ({
    updateSettings: vi.fn(async (args) => {
      calls.push({ index: name, method: 'updateSettings', args })
      return { taskUid: 1 }
    }),
    addDocuments: vi.fn(async (docs, opts) => {
      calls.push({ index: name, method: 'addDocuments', args: { docs, opts } })
      return { taskUid: 2 }
    }),
    deleteDocuments: vi.fn(async (ids) => {
      calls.push({ index: name, method: 'deleteDocuments', args: ids })
      return { taskUid: 3 }
    }),
    search: vi.fn(async (text, params) => {
      calls.push({ index: name, method: 'search', args: { text, params } })
      return responses.search ?? { hits: [] }
    }),
  })
  return { client: { index }, calls }
}
```

- [ ] **Step 2: Write the failing tests**

Create `shared/test/meili.test.js`:

```js
import { describe, expect, it } from 'vitest'

import { createMockMeili } from './meiliClient.js'
import {
  MESSAGES_INDEX,
  addDocuments,
  configureIndex,
  deleteDocuments,
  hybridSearch,
} from '../meili.js'

const ENV = { MEILISEARCH_URL: 'https://meili.test', MEILISEARCH_API_KEY: 'key' }
const USER_ID = '99999999-9999-9999-9999-999999999999'

describe('index descriptors', () => {
  it('describes the messages index', () => {
    expect(MESSAGES_INDEX.name).toBe('messages')
    expect(MESSAGES_INDEX.primaryKey).toBe('id')
    expect(MESSAGES_INDEX.searchable).toContain('subject')
    expect(MESSAGES_INDEX.filterable).toContain('user_id')
  })

  // The embedder is what retires our own pipeline; the model must not drift.
  it('embeds with text-embedding-3-small at 1536 dimensions', () => {
    expect(MESSAGES_INDEX.embedder.source).toBe('openAi')
    expect(MESSAGES_INDEX.embedder.model).toBe('text-embedding-3-small')
    expect(MESSAGES_INDEX.embedder.dimensions).toBe(1536)
  })
})

describe('configureIndex', () => {
  it('sends settings and the embedder together', async () => {
    const { client, calls } = createMockMeili()

    await configureIndex(ENV, MESSAGES_INDEX, client)

    const [call] = calls
    expect(call.index).toBe('messages')
    expect(call.method).toBe('updateSettings')
    expect(call.args.searchableAttributes).toEqual(MESSAGES_INDEX.searchable)
    expect(call.args.embedders.default.source).toBe('openAi')
  })

  // The key reaches Meilisearch through settings; without it the embedder is
  // configured but cannot embed.
  it('passes the OpenAI key to the embedder', async () => {
    const { client, calls } = createMockMeili()

    await configureIndex({ ...ENV, OPENAI_API_KEY: 'sk-test' }, MESSAGES_INDEX, client)

    expect(calls[0].args.embedders.default.apiKey).toBe('sk-test')
  })
})

describe('hybridSearch', () => {
  it('always filters by user_id', async () => {
    const { client, calls } = createMockMeili({ search: { hits: [{ id: 'a' }] } })

    await hybridSearch(ENV, MESSAGES_INDEX, { userId: USER_ID, text: 'roof', limit: 20 }, client)

    expect(calls[0].args.params.filter).toContain(`user_id = '${USER_ID}'`)
  })

  it('asks for hybrid ranking at the descriptor default', async () => {
    const { client, calls } = createMockMeili({ search: { hits: [] } })

    await hybridSearch(ENV, MESSAGES_INDEX, { userId: USER_ID, text: 'roof', limit: 20 }, client)

    expect(calls[0].args.params.hybrid).toEqual({ embedder: 'default', semanticRatio: 0.5 })
  })

  it('lets a caller override semanticRatio', async () => {
    const { client, calls } = createMockMeili({ search: { hits: [] } })

    await hybridSearch(
      ENV,
      MESSAGES_INDEX,
      { userId: USER_ID, text: 'roof', limit: 20, semanticRatio: 1 },
      client,
    )

    expect(calls[0].args.params.hybrid.semanticRatio).toBe(1)
  })

  it('ands extra filters onto the user filter', async () => {
    const { client, calls } = createMockMeili({ search: { hits: [] } })

    await hybridSearch(
      ENV,
      MESSAGES_INDEX,
      { userId: USER_ID, text: 'roof', filter: 'is_archived = false', limit: 20 },
      client,
    )

    expect(calls[0].args.params.filter).toBe(`user_id = '${USER_ID}' AND is_archived = false`)
  })

  it('returns hit ids in Meilisearch order', async () => {
    const { client } = createMockMeili({ search: { hits: [{ id: 'b' }, { id: 'a' }] } })

    const ids = await hybridSearch(
      ENV,
      MESSAGES_INDEX,
      { userId: USER_ID, text: 'roof', limit: 20 },
      client,
    )

    expect(ids).toEqual([{ id: 'b' }, { id: 'a' }])
  })
})

describe('addDocuments', () => {
  it('maps rows through the descriptor and sends the primary key', async () => {
    const { client, calls } = createMockMeili()

    await addDocuments(
      ENV,
      MESSAGES_INDEX,
      [{ id: 'm1', user_id: USER_ID, subject: 'Roof', body_text: 'tiles', labels: [] }],
      client,
    )

    expect(calls[0].args.opts).toEqual({ primaryKey: 'id' })
    expect(calls[0].args.docs[0]).toMatchObject({ id: 'm1', subject: 'Roof' })
  })
})

describe('deleteDocuments', () => {
  it('deletes by id from the descriptor index', async () => {
    const { client, calls } = createMockMeili()

    await deleteDocuments(ENV, MESSAGES_INDEX, ['m1'], client)

    expect(calls[0]).toMatchObject({ index: 'messages', method: 'deleteDocuments', args: ['m1'] })
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd ~/Development/Projects/Cookie/Cookie-Worker && npx vitest run shared/test/meili.test.js`
Expected: FAIL — `configureIndex`, `hybridSearch` and `MESSAGES_INDEX` are not exported.

- [ ] **Step 4: Put the embedder in its own module**

`meili.js` re-exports the descriptors and the descriptors need `EMBEDDER`, so
`EMBEDDER` cannot live in `meili.js` — that is an import cycle, and because a
descriptor spreads `EMBEDDER` while its module is evaluating, the cycle would
resolve it to `undefined` rather than failing loudly.

Create `shared/meili/embedder.js`:

```js
/**
 * Shared embedder settings. The model must match what the app embedded
 * before, so this migration changes where vectors come from and not which
 * model makes them.
 *
 * Its own module because both descriptors need it and meili.js re-exports
 * both descriptors: putting it in meili.js would be a cycle.
 */
export const EMBEDDER = {
  source: 'openAi',
  model: 'text-embedding-3-small',
  dimensions: 1536,
}
```

- [ ] **Step 5: Extract the messages descriptor**

Create `shared/meili/messages.js`, moving the attribute lists out of the current `configureMeiliIndex` and the mapping out of `buildMeiliDocument` **unchanged** — this task must not alter what messages index or how they rank:

```js
import { EMBEDDER } from './embedder.js'

/**
 * The messages index. Attributes and mapping are lifted verbatim from the
 * previous configureMeiliIndex/buildMeiliDocument so this refactor changes
 * nothing about how messages are indexed or ranked.
 */
export const MESSAGES_INDEX = {
  name: 'messages',
  primaryKey: 'id',
  searchable: ['subject', 'body', 'from_name', 'from_address', 'labels', 'to_name', 'to_address'],
  filterable: [
    'user_id',
    'labels',
    'is_unread',
    'is_starred',
    'is_archived',
    'is_sent',
    'is_deleted',
    'has_attachments',
    'sent_at',
  ],
  sortable: ['sent_at'],
  semanticRatio: 0.5,
  // Subject and body only: the same text the app embedded itself. Addresses
  // and labels stay searchable but out of the vector, so a label never
  // dilutes what a message is about.
  embedder: {
    ...EMBEDDER,
    documentTemplate: '{{doc.subject}}\n\n{{doc.body}}',
  },
  toDocument: (message) => ({
    id: message.id,
    user_id: message.user_id,
    subject: message.subject ?? '',
    body: message.body_text ?? '',
    from_name: message.from_name ?? '',
    from_address: message.from_address ?? '',
    to_name: (message.recipients ?? []).map((r) => r.name ?? '').join(' '),
    to_address: (message.recipients ?? []).map((r) => r.address ?? '').join(' '),
    labels: (message.labels ?? []).map((l) => l.name),
    sent_at: message.sent_at ? new Date(message.sent_at).getTime() : 0,
    is_unread: Boolean(message.is_unread),
    is_starred: Boolean(message.is_starred),
    is_archived: Boolean(message.is_archived),
    is_sent: Boolean(message.is_sent),
    is_deleted: Boolean(message.is_deleted),
    has_attachments: Boolean(message.has_attachments),
  }),
}
```

Check the current `buildMeiliDocument` before writing this and match it field for field; if it differs from the above, **the existing code wins** and this plan's copy is what is wrong.

- [ ] **Step 6: Generalise `shared/meili.js`**

Add to `shared/meili.js`, keeping every existing export in place (phase 2 removes them):

```js
export { MESSAGES_INDEX } from './meili/messages.js'
export { EMBEDDER } from './meili/embedder.js'

/** @param {any} env @param {any} client */
function clientFor(env, client) {
  return client ?? getClient(env)
}

/**
 * @param {any} env
 * @param {any} descriptor
 * @param {any} [client] injected by tests
 */
export async function configureIndex(env, descriptor, client) {
  const index = clientFor(env, client).index(descriptor.name)
  await index.updateSettings({
    searchableAttributes: descriptor.searchable,
    filterableAttributes: descriptor.filterable,
    sortableAttributes: descriptor.sortable,
    embedders: {
      default: { ...descriptor.embedder, apiKey: env.OPENAI_API_KEY },
    },
  })
}

/**
 * @param {any} env
 * @param {any} descriptor
 * @param {Record<string, unknown>[]} rows
 * @param {any} [client]
 */
export function addDocuments(env, descriptor, rows, client) {
  const index = clientFor(env, client).index(descriptor.name)
  return index.addDocuments(rows.map(descriptor.toDocument), {
    primaryKey: descriptor.primaryKey,
  })
}

/**
 * @param {any} env
 * @param {any} descriptor
 * @param {string[]} ids
 * @param {any} [client]
 */
export function deleteDocuments(env, descriptor, ids, client) {
  return clientFor(env, client).index(descriptor.name).deleteDocuments(ids)
}

/**
 * One hybrid query. user_id is always filtered: Postgres did that with a
 * WHERE clause, and leaving it off here would return another person's rows.
 *
 * @param {any} env
 * @param {any} descriptor
 * @param {{userId: string, text?: string, filter?: string, limit: number, semanticRatio?: number, sort?: string[]}} query
 * @param {any} [client]
 * @returns {Promise<{id: string}[]>}
 */
export async function hybridSearch(env, descriptor, query, client) {
  const index = clientFor(env, client).index(descriptor.name)
  const filters = [`user_id = '${escapeFilter(query.userId)}'`]
  if (query.filter) filters.push(query.filter)

  const result = await index.search(query.text ?? '', {
    limit: query.limit,
    filter: filters.join(' AND '),
    attributesToRetrieve: ['id'],
    ...(query.sort ? { sort: query.sort } : {}),
    hybrid: {
      embedder: 'default',
      semanticRatio: query.semanticRatio ?? descriptor.semanticRatio,
    },
  })
  return result.hits.map((hit) => ({ id: hit.id }))
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run shared/test/meili.test.js`
Expected: PASS.

- [ ] **Step 8: Verify the message path is unchanged**

Run: `npm test`
Expected: PASS. The existing message search tests must not need editing — if any does, the descriptor drifted from `buildMeiliDocument` and Step 4 is wrong.

- [ ] **Step 9: Commit**

```bash
git add shared/meili.js shared/meili/embedder.js shared/meili/messages.js shared/test/
git commit -m "Make the Meilisearch layer index-agnostic, and testable"
```

---

### Task 2: The `documents` index descriptor

**Files:**

- Create: `shared/meili/documents.js`
- Test: `shared/test/meiliDocuments.test.js`

**Interfaces:**

- Consumes: `EMBEDDER` from `shared/meili.js` (Task 1).
- Produces: `DOCUMENTS_INDEX`, same descriptor shape as `MESSAGES_INDEX`.

- [ ] **Step 1: Write the failing tests**

Create `shared/test/meiliDocuments.test.js`:

```js
import { describe, expect, it } from 'vitest'

import { DOCUMENTS_INDEX } from '../meili/documents.js'

describe('documents index descriptor', () => {
  it('searches title, body and tags', () => {
    expect(DOCUMENTS_INDEX.searchable).toEqual(['title', 'content_text', 'tags'])
  })

  // user_id is the only thing separating one person's documents from another's
  // once retrieval leaves Postgres.
  it('can filter by user, tags, starred and updated_at', () => {
    expect(DOCUMENTS_INDEX.filterable).toEqual(['user_id', 'tags', 'starred', 'updated_at'])
  })

  it('sorts by updated_at, which replaces the recency leg', () => {
    expect(DOCUMENTS_INDEX.sortable).toEqual(['updated_at'])
  })

  it('embeds title and body but not tags', () => {
    expect(DOCUMENTS_INDEX.embedder.documentTemplate).toContain('doc.title')
    expect(DOCUMENTS_INDEX.embedder.documentTemplate).toContain('doc.content_text')
    expect(DOCUMENTS_INDEX.embedder.documentTemplate).not.toContain('doc.tags')
  })

  it('maps a row to a document', () => {
    const doc = DOCUMENTS_INDEX.toDocument({
      id: 'd1',
      user_id: 'u1',
      title: 'Roof plan',
      content_text: 'tiles and gutters',
      tags: ['home'],
      starred: true,
      updated_at: '2026-08-31T10:00:00Z',
    })

    expect(doc).toEqual({
      id: 'd1',
      user_id: 'u1',
      title: 'Roof plan',
      content_text: 'tiles and gutters',
      tags: ['home'],
      starred: true,
      updated_at: new Date('2026-08-31T10:00:00Z').getTime(),
    })
  })

  // Meilisearch sorts and filters numbers, not ISO strings.
  it('stores updated_at as a number', () => {
    const doc = DOCUMENTS_INDEX.toDocument({ id: 'd1', updated_at: '2026-08-31T10:00:00Z' })
    expect(typeof doc.updated_at).toBe('number')
  })

  it('tolerates a document with no title, body or tags', () => {
    const doc = DOCUMENTS_INDEX.toDocument({ id: 'd1', user_id: 'u1' })
    expect(doc).toMatchObject({ title: '', content_text: '', tags: [], starred: false })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run shared/test/meiliDocuments.test.js`
Expected: FAIL — cannot resolve `../meili/documents.js`.

- [ ] **Step 3: Write the descriptor**

Create `shared/meili/documents.js`:

```js
import { EMBEDDER } from './embedder.js'

/**
 * The documents index. Attributes come from what documentRetrieval.js reads
 * today — id, user_id, title, tags, starred, updated_at — plus content_text,
 * the flattened body flattenBlocksToText already produces.
 */
export const DOCUMENTS_INDEX = {
  name: 'documents',
  primaryKey: 'id',
  searchable: ['title', 'content_text', 'tags'],
  filterable: ['user_id', 'tags', 'starred', 'updated_at'],
  sortable: ['updated_at'],
  semanticRatio: 0.5,
  // Title and body only, matching what the app embedded. Tags stay searchable
  // but out of the vector so a tag never dilutes what a document is about.
  embedder: {
    ...EMBEDDER,
    documentTemplate: '{{doc.title}}\n\n{{doc.content_text}}',
  },
  toDocument: (row) => ({
    id: row.id,
    user_id: row.user_id,
    title: row.title ?? '',
    content_text: row.content_text ?? '',
    tags: row.tags ?? [],
    starred: Boolean(row.starred),
    // Numeric so Meilisearch can sort and filter on it.
    updated_at: row.updated_at ? new Date(row.updated_at).getTime() : 0,
  }),
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run shared/test/meiliDocuments.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/meili/documents.js shared/test/meiliDocuments.test.js
git commit -m "Describe the documents Meilisearch index"
```

---

### Task 3: Sync documents to Meilisearch on write

**Files:**

- Create: `workers/cookie-web-tasks/src/documentMeiliSync.js`
- Modify: `workers/cookie-web-tasks/src/documents.js`
- Test: `workers/cookie-web-tasks/test/documentMeiliSync.test.js`

**Interfaces:**

- Consumes: `DOCUMENTS_INDEX` (Task 2); `addDocuments`, `deleteDocuments`, `meiliAvailable` (Task 1).
- Produces:
  - `syncDocumentToMeili(sql, env, documentId)` → `Promise<void>`
  - `removeDocumentFromMeili(env, documentId)` → `Promise<void>`

Both are best-effort: a save must never fail because search indexing did. Task 4 adds the watermark that makes a missed sync recoverable.

- [ ] **Step 1: Write the failing tests**

Create `workers/cookie-web-tasks/test/documentMeiliSync.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'

import { createMockSql } from './helpers.js'
import { removeDocumentFromMeili, syncDocumentToMeili } from '../src/documentMeiliSync.js'

const ENV = { MEILISEARCH_URL: 'https://meili.test', MEILISEARCH_API_KEY: 'key' }
const DOC_ID = '11111111-1111-4111-8111-111111111111'

describe('syncDocumentToMeili', () => {
  it('does nothing when Meilisearch is not configured', async () => {
    const sql = createMockSql([])

    await syncDocumentToMeili(sql, {}, DOC_ID)

    expect(sql.calls).toHaveLength(0)
  })

  it('reads the row and pushes it', async () => {
    const sql = createMockSql([[{ id: DOC_ID, user_id: 'u1', title: 'Roof' }]])
    const push = vi.fn(async () => ({ taskUid: 1 }))

    await syncDocumentToMeili(sql, ENV, DOC_ID, { addDocuments: push })

    expect(sql.calls[0].text).toContain('FROM documents')
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][2][0]).toMatchObject({ id: DOC_ID })
  })

  it('does nothing when the document has gone', async () => {
    const sql = createMockSql([[]])
    const push = vi.fn()

    await syncDocumentToMeili(sql, ENV, DOC_ID, { addDocuments: push })

    expect(push).not.toHaveBeenCalled()
  })

  // A save must not fail because search indexing did.
  it('swallows a Meilisearch failure', async () => {
    const sql = createMockSql([[{ id: DOC_ID, user_id: 'u1' }]])
    const push = vi.fn(async () => {
      throw new Error('meili down')
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      syncDocumentToMeili(sql, ENV, DOC_ID, { addDocuments: push }),
    ).resolves.toBeUndefined()
  })
})

describe('removeDocumentFromMeili', () => {
  it('deletes by id', async () => {
    const remove = vi.fn(async () => ({ taskUid: 1 }))

    await removeDocumentFromMeili(ENV, DOC_ID, { deleteDocuments: remove })

    expect(remove.mock.calls[0][2]).toEqual([DOC_ID])
  })

  it('swallows a Meilisearch failure', async () => {
    const remove = vi.fn(async () => {
      throw new Error('meili down')
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      removeDocumentFromMeili(ENV, DOC_ID, { deleteDocuments: remove }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd workers/cookie-web-tasks && npx vitest run test/documentMeiliSync.test.js`
Expected: FAIL — cannot resolve `../src/documentMeiliSync.js`.

- [ ] **Step 3: Write the module**

Create `workers/cookie-web-tasks/src/documentMeiliSync.js`:

```js
import { DOCUMENTS_INDEX } from '../../../shared/meili/documents.js'
import {
  addDocuments as addDocumentsDefault,
  deleteDocuments as deleteDocumentsDefault,
  meiliAvailable,
} from '../../../shared/meili.js'

/**
 * Best-effort push of one document. Mirrors mail-app-ingest's syncMessageToMeili:
 * reads the authoritative row and pushes it, and never throws — a document save
 * must not fail because search indexing did. A miss is repaired by the drift
 * sweep, which is what search_indexed_at exists for.
 *
 * @param {import('postgres').Sql} sql
 * @param {any} env
 * @param {string} documentId
 * @param {{addDocuments?: Function}} [deps]
 */
export async function syncDocumentToMeili(sql, env, documentId, deps = {}) {
  if (!meiliAvailable(env)) return
  const addDocs = deps.addDocuments ?? addDocumentsDefault

  try {
    const [row] = await sql`
      SELECT d.id, d.user_id, d.title, d.content_text, d.tags, d.starred, d.updated_at
      FROM documents d
      WHERE d.id = ${documentId}
    `
    if (!row) return
    await addDocs(env, DOCUMENTS_INDEX, [row])
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'document_meili_sync_failed',
        document_id: documentId,
        message: /** @type {Error} */ (error).message,
      }),
    )
  }
}

/**
 * @param {any} env
 * @param {string} documentId
 * @param {{deleteDocuments?: Function}} [deps]
 */
export async function removeDocumentFromMeili(env, documentId, deps = {}) {
  if (!meiliAvailable(env)) return
  const removeDocs = deps.deleteDocuments ?? deleteDocumentsDefault

  try {
    await removeDocs(env, DOCUMENTS_INDEX, [documentId])
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'document_meili_delete_failed',
        document_id: documentId,
        message: /** @type {Error} */ (error).message,
      }),
    )
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/documentMeiliSync.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Call it from the document write paths**

In `workers/cookie-web-tasks/src/documents.js`, import both functions and call them after the write commits — `syncDocumentToMeili(sql, env, id)` after create and after update, `removeDocumentFromMeili(env, id)` after delete. Do not `await` them inside a transaction, and do not let a rejection propagate; they already swallow their own errors.

- [ ] **Step 6: Run the tasks suite**

Run: `cd ../.. && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/cookie-web-tasks/src/documentMeiliSync.js workers/cookie-web-tasks/src/documents.js workers/cookie-web-tasks/test/documentMeiliSync.test.js
git commit -m "Sync documents to Meilisearch on create, update and delete"
```

---

### Task 4: `search_indexed_at` watermark

Retiring the embedding backfill does not retire self-healing: a failed sync leaves a row that exists in Postgres and cannot be found. The watermark is what makes that detectable.

**Files:**

- Create: `migrations/0055_search_indexed_at.sql` (Cookie-Web)
- Modify: `workers/cookie-web-tasks/src/documentMeiliSync.js`, `workers/mail-app-ingest/src/meiliSync.js`
- Test: `workers/cookie-web-tasks/test/documentMeiliSync.test.js`

**Interfaces:**

- Consumes: `syncDocumentToMeili` (Task 3).
- Produces: `documents.search_indexed_at` and `messages.search_indexed_at`, stamped on a successful push.

- [ ] **Step 1: Write the migration**

Create `migrations/0055_search_indexed_at.sql` in **Cookie-Web**:

```sql
-- When a row was last successfully pushed to Meilisearch. A row whose
-- updated_at is newer than this drifted — it exists in Postgres and cannot be
-- found — which is what the weekly sweep repairs. NULL means never indexed.

BEGIN;

ALTER TABLE public.documents ADD COLUMN search_indexed_at timestamptz;
ALTER TABLE public.messages ADD COLUMN search_indexed_at timestamptz;

-- Partial indexes: the sweep only ever asks for drifted rows.
CREATE INDEX documents_search_drift_idx ON public.documents (updated_at)
  WHERE search_indexed_at IS NULL OR search_indexed_at < updated_at;
CREATE INDEX messages_search_drift_idx ON public.messages (updated_at)
  WHERE search_indexed_at IS NULL OR search_indexed_at < updated_at;

COMMIT;
```

- [ ] **Step 2: Write the failing test**

Add to `workers/cookie-web-tasks/test/documentMeiliSync.test.js`:

```js
it('stamps search_indexed_at after a successful push', async () => {
  const sql = createMockSql([[{ id: DOC_ID, user_id: 'u1' }], []])
  const push = vi.fn(async () => ({ taskUid: 1 }))

  await syncDocumentToMeili(sql, ENV, DOC_ID, { addDocuments: push })

  expect(sql.calls[1].text).toContain('search_indexed_at = now()')
  expect(sql.calls[1].values).toContain(DOC_ID)
})

// Stamping a row Meilisearch rejected would hide it from the sweep forever.
it('does not stamp when the push fails', async () => {
  const sql = createMockSql([[{ id: DOC_ID, user_id: 'u1' }]])
  const push = vi.fn(async () => {
    throw new Error('meili down')
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})

  await syncDocumentToMeili(sql, ENV, DOC_ID, { addDocuments: push })

  expect(sql.calls).toHaveLength(1)
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd workers/cookie-web-tasks && npx vitest run test/documentMeiliSync.test.js`
Expected: FAIL — only one sql call is made.

- [ ] **Step 4: Stamp the watermark**

In `syncDocumentToMeili`, after `await addDocs(...)` succeeds:

```js
await sql`UPDATE documents SET search_indexed_at = now() WHERE id = ${documentId}`
```

It must sit **after** the push and inside the same `try`, so a failed push leaves the watermark stale and the row visible to the sweep.

- [ ] **Step 5: Do the same for messages**

Apply the identical change to `workers/mail-app-ingest/src/meiliSync.js`: after its successful `addMeiliDocuments`, run `UPDATE messages SET search_indexed_at = now() WHERE id = ${messageUuid}`.

- [ ] **Step 6: Run both suites**

Run: `cd ../.. && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/cookie-web-tasks workers/mail-app-ingest
git commit -m "Stamp search_indexed_at when a row reaches Meilisearch"
```

Commit the migration separately in Cookie-Web:

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
git add migrations/0055_search_indexed_at.sql
git commit -m "Add the search_indexed_at watermark"
```

---

### Task 5: Document search on hybrid, behind the engine switch

**Files:**

- Modify: `workers/cookie-web-tasks/src/documents.js`
- Test: `workers/cookie-web-tasks/test/documents.test.js`

**Interfaces:**

- Consumes: `hybridSearch`, `DOCUMENTS_INDEX`.
- Produces: `GET /documents?q=…` served by Meilisearch, with `&engine=postgres` selecting the old three-leg path unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `workers/cookie-web-tasks/test/documents.test.js`:

```js
describe('document search engine', () => {
  it('searches Meilisearch by default', async () => {
    const search = vi.fn(async () => [{ id: 'd1' }])
    const sql = createMockSql([[{ id: 'd1', title: 'Roof' }]])

    await searchDocuments(sql, USER_ID, url('?q=roof'), { ...DEPS, hybridSearch: search })

    expect(search).toHaveBeenCalledTimes(1)
  })

  // The comparison handle for the soak. Not a fallback: only an explicit
  // engine=postgres reaches the old legs.
  it('uses the Postgres legs when engine=postgres is asked for', async () => {
    const search = vi.fn(async () => [])
    const sql = createMockSql([[], [], [], []])

    await searchDocuments(sql, USER_ID, url('?q=roof&engine=postgres'), {
      ...DEPS,
      hybridSearch: search,
    })

    expect(search).not.toHaveBeenCalled()
  })

  it('passes tag and starred filters to Meilisearch', async () => {
    const search = vi.fn(async () => [])
    const sql = createMockSql([[]])

    await searchDocuments(sql, USER_ID, url('?q=tag%3Ahome+is%3Astarred+roof'), {
      ...DEPS,
      hybridSearch: search,
    })

    const query = search.mock.calls[0][2]
    expect(query.filter).toContain("tags = 'home'")
    expect(query.filter).toContain('starred = true')
  })

  // A filters-only query has no relevance signal, so it sorts newest-first —
  // what the recency leg did.
  it('sorts by updated_at when there is no free text', async () => {
    const search = vi.fn(async () => [])
    const sql = createMockSql([[]])

    await searchDocuments(sql, USER_ID, url('?q=tag%3Ahome'), { ...DEPS, hybridSearch: search })

    expect(search.mock.calls[0][2].sort).toEqual(['updated_at:desc'])
  })

  // Meilisearch is required: a failure is an error, not a silent empty list.
  it('returns 503 when Meilisearch fails', async () => {
    const search = vi.fn(async () => {
      throw new Error('meili down')
    })
    const sql = createMockSql([])

    const response = await searchDocuments(sql, USER_ID, url('?q=roof'), {
      ...DEPS,
      hybridSearch: search,
    })

    expect(response.status).toBe(503)
  })
})
```

`DEPS`, `USER_ID` and `url` follow the file's existing conventions — read the top of `documents.test.js` and match them rather than inventing new ones.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/documents.test.js`
Expected: FAIL — search still goes to Postgres.

- [ ] **Step 3: Add the engine switch**

In `searchDocuments`, before the existing leg code:

```js
// engine=postgres is the soak-period comparison handle, not a fallback: it
// is never selected automatically, and phase 2 deletes it along with the
// legs it reaches.
const engine = url.searchParams.get('engine') === 'postgres' ? 'postgres' : 'meili'
if (engine === 'meili') {
  return await searchViaMeili(sql, userId, spec, deps)
}
```

Leave everything below it untouched.

- [ ] **Step 4: Write the Meilisearch path**

```js
/**
 * Structured filters as a Meilisearch expression. user_id is added by
 * hybridSearch itself, so it is deliberately absent here.
 *
 * @param {{tag?: string, starred?: boolean}} filters
 */
function meiliFilter(filters) {
  const parts = []
  if (filters.tag) parts.push(`tags = '${filters.tag.replace(/[\\']/g, '\\$&')}'`)
  if (filters.starred) parts.push('starred = true')
  return parts.join(' AND ') || undefined
}

async function searchViaMeili(sql, userId, spec, deps) {
  let hits
  try {
    hits = await deps.hybridSearch(deps.env, DOCUMENTS_INDEX, {
      userId,
      text: spec.text ?? '',
      filter: meiliFilter(spec.filters),
      limit: SEARCH_RESULTS,
      // No free text means no relevance signal, so fall back to newest-first —
      // what the recency leg did.
      ...(spec.text ? {} : { sort: ['updated_at:desc'] }),
    })
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'document_search_meili_failed',
        message: /** @type {Error} */ (error).message,
      }),
    )
    return Response.json({ error: 'Search is unavailable' }, { status: 503 })
  }

  const ids = hits.map((hit) => hit.id)
  if (ids.length === 0) return Response.json({ documents: [] })
  // Meilisearch returns ids; the rows still come from Postgres so the response
  // shape is unchanged.
  return await respondWithDocuments(sql, userId, ids)
}
```

`respondWithDocuments` is the existing hydration step at the end of `searchDocuments` — extract it rather than duplicating the SELECT, so both engines return identical shapes.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/documents.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/cookie-web-tasks
git commit -m "Serve document search from Meilisearch, keeping Postgres behind engine=postgres"
```

---

### Task 6: Message search and Ask on hybrid

**Files:**

- Modify: `workers/cookie-web-search/src/search.js`, `workers/cookie-web-search/src/ask.js`
- Test: `workers/cookie-web-search/test/search.test.js`

**Interfaces:**

- Consumes: `hybridSearch`, `MESSAGES_INDEX`.
- Produces: message search and Ask retrieval served by Meilisearch, `&engine=postgres` selecting the old path.

`from:`, `to:` and `in:` change here. `meiliCanHandle` routed them to Postgres because they need substring and folder predicates; per the spec they become **exact match** and **a filter over `is_archived`/`is_sent`/`is_deleted`**.

- [ ] **Step 1: Write the failing tests**

Add to `workers/cookie-web-search/test/search.test.js`:

```js
describe('message search on Meilisearch', () => {
  it('searches Meilisearch by default', async () => {
    const search = vi.fn(async () => [{ id: 'm1' }])
    const sql = createMockSql([[{ id: 'm1' }]])

    await searchMessages(sql, USER_ID, url('?q=roof'), { ...DEPS, hybridSearch: search })

    expect(search).toHaveBeenCalledTimes(1)
  })

  it('uses the Postgres legs when engine=postgres is asked for', async () => {
    const search = vi.fn(async () => [])
    const sql = createMockSql([[], [], [], []])

    await searchMessages(sql, USER_ID, url('?q=roof&engine=postgres'), {
      ...DEPS,
      hybridSearch: search,
    })

    expect(search).not.toHaveBeenCalled()
  })

  // Was substring in Postgres; exact in Meilisearch, per the spec.
  it('matches from: exactly', async () => {
    const search = vi.fn(async () => [])
    const sql = createMockSql([[]])

    await searchMessages(sql, USER_ID, url('?q=from%3Abob%40example.com+roof'), {
      ...DEPS,
      hybridSearch: search,
    })

    expect(search.mock.calls[0][2].filter).toContain("from_address = 'bob@example.com'")
  })

  it('turns in:archived into a filter', async () => {
    const search = vi.fn(async () => [])
    const sql = createMockSql([[]])

    await searchMessages(sql, USER_ID, url('?q=in%3Aarchived+roof'), {
      ...DEPS,
      hybridSearch: search,
    })

    expect(search.mock.calls[0][2].filter).toContain('is_archived = true')
  })

  it('excludes deleted messages unless asked for them', async () => {
    const search = vi.fn(async () => [])
    const sql = createMockSql([[]])

    await searchMessages(sql, USER_ID, url('?q=roof'), { ...DEPS, hybridSearch: search })

    expect(search.mock.calls[0][2].filter).toContain('is_deleted = false')
  })

  it('returns 503 when Meilisearch fails', async () => {
    const search = vi.fn(async () => {
      throw new Error('meili down')
    })
    const sql = createMockSql([])

    const response = await searchMessages(sql, USER_ID, url('?q=roof'), {
      ...DEPS,
      hybridSearch: search,
    })

    expect(response.status).toBe(503)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd workers/cookie-web-search && npx vitest run test/search.test.js`
Expected: FAIL.

- [ ] **Step 3: Build the message filter expression**

```js
/**
 * Structured filters as a Meilisearch expression. user_id is added by
 * hybridSearch. from:/to: are exact matches now — Postgres did substring, and
 * per the design that behaviour change is preferred to depending on
 * Meilisearch's experimental containsFilter.
 *
 * @param {Record<string, any>} filters
 */
export function meiliMessageFilter(filters) {
  const quote = (value) => `'${String(value).replace(/[\\']/g, '\\$&')}'`
  const parts = []

  if (filters.from) parts.push(`from_address = ${quote(filters.from)}`)
  if (filters.to) parts.push(`to_address = ${quote(filters.to)}`)
  if (filters.tag) parts.push(`labels = ${quote(filters.tag)}`)
  if (filters.starred) parts.push('is_starred = true')
  if (filters.unread) parts.push('is_unread = true')
  if (filters.attachment) parts.push('has_attachments = true')

  // Folders. in:archived / in:sent / in:trash replace the SQL folder
  // predicates; anything else leaves the default exclusion below in place.
  if (filters.in === 'archived') parts.push('is_archived = true')
  if (filters.in === 'sent') parts.push('is_sent = true')
  if (filters.in === 'trash') parts.push('is_deleted = true')

  // Deleted mail stays out unless it was explicitly asked for.
  if (filters.in !== 'trash') parts.push('is_deleted = false')

  return parts.join(' AND ') || undefined
}
```

Read `queryParse.js` before writing this and match its filter key names exactly; if they differ from the above, **the parser wins**.

- [ ] **Step 4: Route search through it**

Add the same `engine` switch as Task 5 to `searchMessages`, calling `deps.hybridSearch(deps.env, MESSAGES_INDEX, { userId, text: spec.text ?? '', filter: meiliMessageFilter(spec.filters), limit: RESULTS, ...(spec.text ? {} : { sort: ['sent_at:desc'] }) })`, returning 503 on failure, then hydrating rows from Postgres by id exactly as the Postgres path does.

- [ ] **Step 5: Route Ask through it**

`ask.js` retrieves with the same call. Its `embedTextCached` usage for retrieval goes away — Meilisearch embeds the query — but leave the import if anything else in the file uses it.

- [ ] **Step 6: Run the suite**

Run: `cd ../.. && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/cookie-web-search
git commit -m "Serve message search and Ask from Meilisearch"
```

---

### Task 7: One-off reindex of both corpora

**Files:**

- Create: `scripts/reindex-meili.js` (Cookie-Web)

This is the slow, costly step: Meilisearch embeds every document as it indexes. Run it once, watch the task queue, and confirm counts before any read path is switched in production.

- [ ] **Step 1: Write the script**

Create `scripts/reindex-meili.js`, modelled on `scripts/backfill-embeddings.js` — read that file first and match its connection handling and batching:

```js
// One-off: pushes every document and message into Meilisearch, which embeds
// them as it indexes. Idempotent — safe to re-run — and stamps
// search_indexed_at so the weekly drift sweep starts from a clean baseline.
//
// Usage: DATABASE_URL=... MEILISEARCH_URL=... MEILISEARCH_API_KEY=... \
//        OPENAI_API_KEY=... node scripts/reindex-meili.js [documents|messages]

const BATCH_SIZE = 100
```

Structure: `configureIndex` for each index first (so the embedder exists before any document arrives), then page through rows ordered by `id`, `addDocuments` per batch, then `UPDATE ... SET search_indexed_at = now() WHERE id = ANY(...)`. Log a running count per batch so a long run is observable.

- [ ] **Step 2: Verify against a single row**

Run it with a `LIMIT 1` edit, or against one id, and confirm in Meilisearch Cloud that the document appears **and** has an embedding. A document indexed before the embedder is configured has no vector and will not be found semantically.

- [ ] **Step 3: Commit**

```bash
git add scripts/reindex-meili.js
git commit -m "Add the one-off Meilisearch reindex script"
```

---

### Task 8: Repoint the weekly workflow at index drift

**Files:**

- Modify: `.github/workflows/backfill-embeddings.yml` (Cookie-Web)
- Create: `scripts/repair-search-drift.js` (Cookie-Web)

The workflow keeps its schedule and slot; the job changes from embedding NULL vectors to re-pushing rows Meilisearch never received. It also gains the retry its last failure showed it needs — one transient `520` cost a full week of repair.

- [ ] **Step 1: Write the drift script**

Create `scripts/repair-search-drift.js`:

```js
// Re-pushes rows Meilisearch never received. A save-time sync failure leaves
// search_indexed_at behind updated_at; this is the only thing that repairs it.
//
// Usage: DATABASE_URL=... MEILISEARCH_URL=... MEILISEARCH_API_KEY=... \
//        OPENAI_API_KEY=... node scripts/repair-search-drift.js
```

For each of `documents` and `messages`:

```sql
SELECT id FROM documents
WHERE search_indexed_at IS NULL OR search_indexed_at < updated_at
ORDER BY updated_at
LIMIT 500
```

then push those rows and stamp `search_indexed_at`, looping until a page comes back empty.

- [ ] **Step 2: Retry transient upstream failures**

Wrap each Meilisearch call in three attempts with exponential backoff, retrying only on 5xx and network errors — a 4xx is a bug in what we sent and retrying it just wastes time.

- [ ] **Step 3: Rename and repoint the workflow**

Rename the file to `.github/workflows/search-drift-repair.yml`, set `name: Search Drift Repair`, keep `cron: '0 6 * * 1'` and `concurrency`, and replace the two backfill steps with one running `node scripts/repair-search-drift.js`. Bump `actions/setup-node` to the pin `ci.yml` uses and `node-version` to 24 — the current pin emits a Node 20 deprecation warning.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows scripts/repair-search-drift.js
git commit -m "Repoint the weekly workflow from embedding backfill to index drift"
```

---

### Task 9: Rollout

Order matters: the embedder must exist before documents arrive, and every document must be indexed before any read path depends on it.

- [ ] **Step 1: Apply the migration**

```bash
cd ~/Development/Projects/Cookie/Cookie-Web
git push origin main   # migrations/** on main triggers migrate.yml
```

Confirm `apply 0055_search_indexed_at.sql`.

- [ ] **Step 2: Set the Meilisearch secrets**

`OPENAI_API_KEY` must be readable by whichever Workers call `configureIndex`. Confirm `MEILISEARCH_URL` and `MEILISEARCH_API_KEY` are set for `cookie-web-tasks` as they already are for `cookie-web-search` and `mail-app-ingest`.

- [ ] **Step 3: Configure the indexes, then reindex**

```bash
node scripts/reindex-meili.js documents
node scripts/reindex-meili.js messages
```

Wait for Meilisearch's task queue to drain. Confirm the document count in each index matches `SELECT count(*)` in Postgres, and spot-check that a document has an embedding.

- [ ] **Step 4: Push and deploy the Workers**

```bash
cd ~/Development/Projects/Cookie/Cookie-Worker
npm test && npm run lint && npm run typecheck
git push origin main
gh workflow run deploy.yml -f worker=cookie-web-tasks --ref main
gh workflow run deploy.yml -f worker=cookie-web-search --ref main
gh workflow run deploy.yml -f worker=mail-app-ingest --ref main
```

- [ ] **Step 5: Compare**

For a handful of real queries, run each twice:

```
/documents?q=<query>
/documents?q=<query>&engine=postgres
```

Judge whether results got better or worse. **This is the whole reason phase 1 exists** — after phase 2 the vectors are Meilisearch's and there is nothing left to compare against.

- [ ] **Step 6: Soak**

Leave both engines in place until the comparison is convincing. Only then write the phase 2 plan.

---

## Notes for the executor

- **Delete nothing.** No dropped columns, no removed legs, no removed scripts, no removed `meiliCanHandle`. If you are deleting, you are in phase 2 and out of scope.
- **`user_id` on every query.** `hybridSearch` adds it; if you call `index.search` directly anywhere, you have created a cross-user data leak.
- **The descriptors must match the existing behaviour.** Task 1 is a refactor: if an existing message test needs editing, the descriptor is wrong, not the test.
- **`engine=postgres` is never automatic.** It is a comparison handle. A Meilisearch failure returns 503; it does not fall back.
- **Re-read `queryParse.js` before Task 6.** The filter key names in this plan are written from the design, not copied from the parser.
