import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isOnline, resetConnectivityForTests } from '../../lib/connectivity'
import { setOfflineOwner } from '../../lib/offlineCache'
import { OUTBOX_STORE, createOfflineDb, setOfflineDb } from '../../lib/offlineDb'
import { flushOutbox, refreshOutboxPending, registerOutboxHandler } from '../../lib/outbox'
import { DOCUMENT_PATCH, useDocumentsStore } from '../documents'
import { MESSAGE_PATCH, applyQueuedMessageChanges, useInboxStore } from '../inbox'
import { useProjectsStore } from '../projects'
import { TASK_PATCH, applyQueuedTaskChanges, useTaskItemsStore } from '../taskItems'

// The stores cache what the Workers last served and queue what they could
// not send, both in one IndexedDB (fake-indexeddb here); a fresh Pinia with
// the same database stands in for a reload.
let db
let indexedDB
// Every store's notify delegates to the inbox store's, so one spy sees them all.
let notify

const offline = () => Promise.reject(new TypeError('Failed to fetch'))
const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })

function freshPinia() {
  setActivePinia(createPinia())
}

function prepare(store) {
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  notify = vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  return store
}

function registerHandlers() {
  registerOutboxHandler(MESSAGE_PATCH, (payload) => useInboxStore().replayMessagePatch(payload))
  registerOutboxHandler(TASK_PATCH, (payload) => useTaskItemsStore().replayTaskPatch(payload))
  registerOutboxHandler(DOCUMENT_PATCH, (payload) =>
    useDocumentsStore().replayDocumentPatch(payload),
  )
}

const outboxPayloads = async () => (await db.getAll(OUTBOX_STORE)).map((entry) => entry.payload)

beforeEach(() => {
  indexedDB = new IDBFactory()
  db = createOfflineDb({ indexedDB })
  setOfflineDb(db)
  setOfflineOwner('auth0|alice')
  resetConnectivityForTests()
  registerHandlers()
  freshPinia()
})

afterEach(() => {
  setOfflineDb(null)
  setOfflineOwner(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const SENT_AT = '2026-10-13T09:00:00Z'
const EMAIL_ROWS = [
  {
    id: 'a',
    from_address: 'ann@example.com',
    sent_at: SENT_AT,
    is_unread: true,
    is_starred: false,
  },
  {
    id: 'b',
    from_address: 'bob@example.com',
    sent_at: SENT_AT,
    is_unread: false,
    is_starred: true,
  },
]
const INBOX_PAGE = { emails: EMAIL_ROWS, nextCursor: 'more', unreadCount: 7, userId: 'user-1' }

describe('inbox store offline', () => {
  it('shows the last inbox page when the emails Worker cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(INBOX_PAGE)),
    )
    await prepare(useInboxStore()).loadEmails()
    await vi.waitFor(async () => expect(await db.getAll('cache')).not.toHaveLength(0))

    freshPinia()
    vi.stubGlobal('fetch', vi.fn(offline))
    const store = prepare(useInboxStore())
    await store.loadEmails()

    expect(store.traditionalEmails.map((email) => email.id)).toEqual(['a', 'b'])
    expect(store.hasMoreEmails).toBe(false)
    expect(store.unreadInboxCount).toBe(1)
    expect(store.userId).toBe('user-1')
    expect(store.isInboxLoaded).toBe(true)
    expect(store.isRefreshing).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(isOnline.value).toBe(false)
  })

  it('still reports a failure when nothing is cached', async () => {
    vi.stubGlobal('fetch', vi.fn(offline))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = prepare(useInboxStore())

    await store.loadEmails()

    expect(store.traditionalEmails).toEqual([])
    expect(store.isInboxLoaded).toBe(false)
    expect(notify).toHaveBeenCalledWith('Failed to load inbox.', 'error')
  })

  it('keeps a star made offline, queues it, and sends it on replay', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(INBOX_PAGE)),
    )
    const store = prepare(useInboxStore())
    await store.loadEmails()
    const email = store.traditionalEmails.find((row) => row.id === 'a')

    vi.stubGlobal('fetch', vi.fn(offline))
    store.toggleStar(email)
    await vi.waitFor(async () =>
      expect(await outboxPayloads()).toEqual([{ id: 'a', is_starred: true }]),
    )
    expect(email.starred).toBe(true)
    expect(notify).not.toHaveBeenCalled()

    // Toggling back merges into the same queued change.
    store.toggleStar(email)
    await vi.waitFor(async () =>
      expect(await outboxPayloads()).toEqual([{ id: 'a', is_starred: false }]),
    )

    const fetchMock = vi.fn(async () => ok({ message: {} }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await flushOutbox()).toEqual({ replayed: 1, dropped: 0, remaining: 0 })
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/messages')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ id: 'a', is_starred: false })
    expect(await outboxPayloads()).toEqual([])
  })

  it('rolls a star back when the server refuses it, as before', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(INBOX_PAGE)),
    )
    const store = prepare(useInboxStore())
    await store.loadEmails()
    const email = store.traditionalEmails.find((row) => row.id === 'a')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    )
    store.toggleStar(email)
    await vi.waitFor(() => expect(email.starred).toBe(false))

    expect(notify).toHaveBeenCalledWith('Failed to update starred state.', 'error')
    expect(await outboxPayloads()).toEqual([])
  })

  it('lays queued changes over a cached page on the next offline start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(INBOX_PAGE)),
    )
    const first = prepare(useInboxStore())
    await first.loadEmails()
    vi.stubGlobal('fetch', vi.fn(offline))
    first.toggleStar(first.traditionalEmails.find((row) => row.id === 'a'))
    first.archiveEmail(
      first.traditionalEmails.find((row) => row.id === 'b'),
      false,
    )
    await vi.waitFor(async () => expect(await refreshOutboxPending()).toBe(2))

    freshPinia()
    const store = prepare(useInboxStore())
    await store.loadEmails()

    expect(store.traditionalEmails.map((row) => [row.id, row.starred])).toEqual([['a', true]])
  })

  it('falls back to cached labels and inbox state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).includes('/labels')
          ? ok({ labels: [{ id: 'l1', name: 'Home', kind: 'user' }] })
          : ok({ unreadCount: 3, userId: 'user-1', spamCount: 2 }),
      ),
    )
    const first = prepare(useInboxStore())
    await Promise.all([first.loadLabels(), first.loadInboxState()])
    await vi.waitFor(async () => expect(await db.getAll('cache')).toHaveLength(2))

    freshPinia()
    vi.stubGlobal('fetch', vi.fn(offline))
    const store = prepare(useInboxStore())
    await Promise.all([store.loadLabels(), store.loadInboxState()])

    expect(store.labels.map((label) => label.name)).toEqual(['Home'])
    expect(store.isLabelsLoaded).toBe(true)
    expect(store.unreadInboxCount).toBe(3)
    expect(store.spamCount).toBe(2)
    expect(store.isInboxStateLoaded).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('applyQueuedMessageChanges', () => {
  it('applies flags by id and drops archived rows from an inbox page only', () => {
    const rows = [
      { id: 'a', is_starred: false, is_unread: true },
      { id: 'b', is_starred: false, is_unread: true },
    ]
    const entries = [
      { payload: { id: 'a', is_starred: true } },
      { payload: { id: 'b', is_archived: true, is_unread: false } },
    ]

    expect(applyQueuedMessageChanges(rows, entries, { dropArchived: true })).toEqual([
      { id: 'a', is_starred: true, is_unread: true },
    ])
    expect(applyQueuedMessageChanges(rows, entries).map((row) => row.id)).toEqual(['a', 'b'])
    expect(applyQueuedMessageChanges(rows, [])).toBe(rows)
  })
})

const TASK = { id: 't1', projectId: 'p1', parentId: null, content: 'Ship it', completedAt: null }
const TASK_2 = { id: 't2', projectId: 'p1', parentId: null, content: 'Test it', completedAt: null }

describe('task items store offline', () => {
  it('shows the cached list with offline edits laid over it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ items: [TASK, TASK_2] })),
    )
    const first = prepare(useTaskItemsStore())
    await first.loadItems('p1')
    await vi.waitFor(async () => expect(await db.getAll('cache')).toHaveLength(1))

    vi.stubGlobal('fetch', vi.fn(offline))
    await first.renameItem('t1', 'Ship it today')
    await first.setCompleted('t2', true)
    expect(first.items.map((item) => item.content)).toEqual(['Ship it today'])
    expect(await outboxPayloads()).toEqual([
      { id: 't1', content: 'Ship it today' },
      { id: 't2', completed: true },
    ])
    expect(notify).not.toHaveBeenCalled()

    freshPinia()
    const store = prepare(useTaskItemsStore())
    await store.loadItems('p1')

    expect(store.items.map((item) => item.content)).toEqual(['Ship it today'])
    expect(store.loadedProject).toBe('p1')
    expect(store.isLoading).toBe(false)

    const fetchMock = vi.fn(async (url, options) => ok({ item: JSON.parse(options.body) }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await flushOutbox()).toEqual({ replayed: 2, dropped: 0, remaining: 0 })
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([
      { id: 't1', content: 'Ship it today' },
      { id: 't2', completed: true },
    ])
  })

  it("does not reuse yesterday's Today list", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ items: [TASK] })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = prepare(useTaskItemsStore())
    await first.loadItems('today')
    await vi.waitFor(async () => expect(await db.getAll('cache')).toHaveLength(1))
    const [entry] = await db.getAll('cache')
    const [key] = (await db.getAll('cache')).length ? ['auth0|alice:tasks:today'] : []
    await db.put('cache', { ...entry, value: { ...entry.value, date: '2000-01-01' } }, key)

    freshPinia()
    vi.stubGlobal('fetch', vi.fn(offline))
    const store = prepare(useTaskItemsStore())
    await store.loadItems('today')

    expect(store.items).toEqual([])
    expect(notify).toHaveBeenCalledWith('Failed to load tasks.', 'error')
  })
})

describe('applyQueuedTaskChanges', () => {
  it('overlays known fields and removes tasks completed offline', () => {
    const items = [TASK, TASK_2, { ...TASK, id: 't3', parentId: 't1' }]
    const entries = [
      { payload: { id: 't1', content: 'Renamed', unknownField: 1 } },
      { payload: { id: 't2', completed: true } },
      { payload: { id: 't3', completed: true } },
    ]

    const result = applyQueuedTaskChanges(items, entries)
    expect(result.map((item) => item.id)).toEqual(['t1', 't3'])
    expect(result[0].content).toBe('Renamed')
    expect(result[0].unknownField).toBeUndefined()
    expect(result[1].completedAt).toEqual(expect.any(String))
  })
})

describe('projects store offline', () => {
  it('shows the cached projects when the Worker cannot be reached', async () => {
    const PROJECT = { id: 'p1', parentId: null, name: 'Work' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ projects: [PROJECT] })),
    )
    await prepare(useProjectsStore()).loadProjects()
    await vi.waitFor(async () => expect(await db.getAll('cache')).toHaveLength(1))

    freshPinia()
    vi.stubGlobal('fetch', vi.fn(offline))
    const store = prepare(useProjectsStore())

    expect(await store.loadProjects()).toBe(true)
    expect(store.projects).toEqual([PROJECT])
    expect(store.isLoaded).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })
})

const FOLDERS = [{ id: 'f-1', parent_id: null, title: 'Projects', emoji: '📁' }]
const DOC = {
  id: 'd-1',
  folder_id: 'f-1',
  title: 'Plan',
  emoji: '🔹',
  starred: false,
  tags: [],
  updated_at: 't0',
  blocks: [{ type: 'paragraph', data: { text: 'v1' } }],
}

function documentRoutes(overrides = {}) {
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    const handler = overrides[method]
    if (handler) return handler(url, options.body ? JSON.parse(options.body) : undefined)
    if (method === 'GET' && String(url).includes('view=meta')) {
      return ok({ folders: FOLDERS, documents: [DOC] })
    }
    if (method === 'GET') return ok({ document: DOC })
    throw new Error(`Unexpected ${method} ${url}`)
  })
}

describe('documents store offline', () => {
  it('shows the cached workspace and the last opened document', async () => {
    vi.stubGlobal('fetch', documentRoutes())
    const first = prepare(useDocumentsStore())
    await first.loadWorkspace()
    await first.openDocument('d-1')
    await vi.waitFor(async () => expect(await db.getAll('cache')).toHaveLength(3))

    freshPinia()
    vi.stubGlobal('fetch', vi.fn(offline))
    const store = prepare(useDocumentsStore())

    expect(await store.loadWorkspace()).toBe(true)
    expect(store.folders).toEqual(FOLDERS)
    expect(store.documents.map((doc) => doc.id)).toEqual(['d-1'])
    await store.openDocument('d-1')
    expect(store.openDoc).toEqual(DOC)
    expect(store.isOpenDocLoading).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('queues an edit the Worker cannot be reached for and shows it on reopen', async () => {
    vi.stubGlobal('fetch', documentRoutes())
    const store = prepare(useDocumentsStore())
    await store.loadWorkspace()
    await store.openDocument('d-1')
    await vi.waitFor(async () => expect(await db.getAll('cache')).toHaveLength(3))

    vi.stubGlobal('fetch', vi.fn(offline))
    const blocks = [{ type: 'paragraph', data: { text: 'v2' } }]
    store.scheduleContentSave('d-1', { title: 'Plan v2' })
    store.scheduleContentSave('d-1', { blocks })
    expect(await store.flushPendingSave()).toBe(true)

    expect(store.saveState).toBe('offline')
    expect(store.saveConflict).toBe(false)
    expect(await outboxPayloads()).toEqual([
      { id: 'd-1', title: 'Plan v2', blocks, updatedAt: 't0' },
    ])

    freshPinia()
    vi.stubGlobal('fetch', vi.fn(offline))
    const reopened = prepare(useDocumentsStore())
    await reopened.openDocument('d-1')
    expect(reopened.openDoc.title).toBe('Plan v2')
    expect(reopened.openDoc.blocks).toEqual(blocks)

    const fetchMock = documentRoutes({
      PATCH: (url, body) => ok({ document: { ...DOC, ...body, updated_at: 't1' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await flushOutbox()).toEqual({ replayed: 1, dropped: 0, remaining: 0 })
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(JSON.parse(patch[1].body)).toEqual({
      id: 'd-1',
      title: 'Plan v2',
      blocks,
      updatedAt: 't0',
    })
  })

  it('saves queued edits as a copy when the document changed elsewhere meanwhile', async () => {
    vi.stubGlobal('fetch', documentRoutes())
    const store = prepare(useDocumentsStore())
    await store.loadWorkspace()
    await store.openDocument('d-1')
    vi.stubGlobal('fetch', vi.fn(offline))
    store.scheduleContentSave('d-1', { title: 'Plan v2' })
    expect(await store.flushPendingSave()).toBe(true)
    expect(await refreshOutboxPending()).toBe(1)

    const copy = { ...DOC, id: 'd-copy', title: 'Plan v2 (offline copy)', updated_at: 't2' }
    const fetchMock = documentRoutes({
      PATCH: (url, body) =>
        body.id === 'd-1'
          ? { ok: false, status: 409, json: async () => ({ error: 'Changed elsewhere' }) }
          : ok({ document: { ...copy, ...body } }),
      POST: () => ok({ document: copy }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await flushOutbox()).toEqual({ replayed: 1, dropped: 0, remaining: 0 })
    const bodies = fetchMock.mock.calls
      .filter(([, options]) => ['POST', 'PATCH'].includes(options?.method))
      .map(([, options]) => JSON.parse(options.body))
    expect(bodies).toEqual([
      { id: 'd-1', title: 'Plan v2', updatedAt: 't0' },
      { kind: 'document', folderId: 'f-1', templateId: null, title: 'Plan v2 (offline copy)' },
      { id: 'd-copy', title: 'Plan v2 (offline copy)' },
    ])
    expect(store.documents.map((doc) => doc.id)).toEqual(['d-copy', 'd-1'])
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('saved as a copy'), 'info')
  })
})
