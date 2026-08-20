import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentsStore } from '../documents'
import { useInboxStore } from '../../stores/inbox'
import { TASKS_API_URL } from '../../lib/apiWorkers'

const FOLDERS = [{ id: 'f-1', parent_id: null, title: 'Projects', emoji: '📁' }]
const DOCS = [
  {
    id: 'd-1',
    folder_id: 'f-1',
    title: 'Plan',
    emoji: '🔹',
    starred: false,
    tags: ['project', 'home'],
    updated_at: 't0',
  },
  {
    id: 'd-2',
    folder_id: null,
    title: 'Scratch',
    emoji: '🔹',
    starred: true,
    tags: ['home'],
    updated_at: 't0',
  },
]

function stubFetch(routes) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    const handler = routes[method]
    if (!handler) throw new Error(`Unexpected fetch: ${method} ${url}`)
    return handler(url, body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const ok = (payload) => ({ ok: true, json: async () => payload })
const fail = () => ({ ok: false, status: 500, json: async () => ({}) })

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useDocumentsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('documents store', () => {
  it('loads folders and documents together', async () => {
    stubFetch({ GET: () => ok({ folders: FOLDERS, documents: DOCS }) })

    await store.loadWorkspace()

    expect(store.folders).toHaveLength(1)
    expect(store.documents).toHaveLength(2)
    expect(store.starredDocuments.map((doc) => doc.id)).toEqual(['d-2'])
    expect(store.documentTags).toEqual([
      { name: 'home', count: 2 },
      { name: 'project', count: 1 },
    ])
  })

  it('resolves openDocDailyDate only for a title-and-folder daily note', () => {
    store.folders = [
      { id: 'daily', parent_id: null, title: 'Daily' },
      { id: 'year', parent_id: 'daily', title: '2026' },
      { id: 'month', parent_id: 'year', title: 'Aug' },
      { id: 'projects', parent_id: null, title: 'Projects' },
    ]

    store.openDoc = null
    expect(store.openDocDailyDate).toBeNull()

    store.openDoc = { folder_id: 'month', title: 'Not a date' }
    expect(store.openDocDailyDate).toBeNull()

    store.openDoc = { folder_id: 'projects', title: '13-08-26' }
    expect(store.openDocDailyDate).toBeNull()

    store.openDoc = { folder_id: 'month', title: '13-08-26' }
    expect(store.openDocDailyDate).toEqual(new Date(2026, 7, 13))
  })

  it('creates a document and prepends it to the list', async () => {
    stubFetch({
      POST: (url, body) =>
        ok({ document: { id: 'd-new', folder_id: body.folderId, title: '', starred: false } }),
    })

    const doc = await store.createDocument({ folderId: 'f-1' })

    expect(doc.id).toBe('d-new')
    expect(store.documents[0].id).toBe('d-new')
  })

  it('loads templates and creates a document from one', async () => {
    const fetchMock = stubFetch({
      GET: () => ok({ templates: [{ id: 't-1', title: 'Meeting notes', emoji: '📄' }] }),
      POST: (url, body) =>
        ok({
          document: {
            id: 'd-template',
            folder_id: body.folderId,
            title: 'Meeting notes',
            emoji: '📄',
            starred: false,
          },
        }),
    })

    await store.loadTemplates()
    const doc = await store.createDocument({ folderId: 'f-1', templateId: 't-1' })

    expect(store.templates[0].title).toBe('Meeting notes')
    expect(doc.title).toBe('Meeting notes')
    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(createBody).toMatchObject({
      kind: 'document',
      folderId: 'f-1',
      templateId: 't-1',
    })
  })

  it('creates, updates, and deletes document templates', async () => {
    let saved = { id: 't-1', title: 'Meeting notes', emoji: '📄', blocks: [] }
    stubFetch({
      POST: (url, body) => {
        saved = { ...saved, title: body.title, blocks: body.blocks }
        return ok({ template: saved })
      },
      PATCH: (url, body) => {
        saved = { ...saved, title: body.title, blocks: body.blocks }
        return ok({ template: saved })
      },
      DELETE: () => ok({ ok: true }),
    })

    await store.createTemplate({ title: 'Meeting notes', blocks: [] })
    expect(store.templates[0].title).toBe('Meeting notes')

    await store.updateTemplate('t-1', {
      title: 'Weekly notes',
      blocks: [{ type: 'header' }],
    })
    expect(store.templates[0].title).toBe('Weekly notes')

    await store.deleteTemplate('t-1')
    expect(store.templates).toHaveLength(0)
  })

  it('rolls an optimistic star back when the PATCH fails', async () => {
    store.documents = structuredClone(DOCS)
    stubFetch({ PATCH: fail })

    await store.toggleStar('d-1')

    expect(store.documents.find((doc) => doc.id === 'd-1').starred).toBe(false)
  })

  it('debounces content saves and PATCHes title, blocks, and tags together', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    const fetchMock = stubFetch({
      PATCH: (url, body) => ok({ document: { id: body.id, updated_at: 't1' } }),
    })

    store.scheduleContentSave('d-1', { title: 'Plan v2' })
    store.scheduleContentSave('d-1', { blocks: [{ type: 'paragraph' }] })
    store.scheduleContentSave('d-1', { tags: ['project', 'urgent'] })
    expect(store.saveState).toBe('saving')
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent).toEqual({
      id: 'd-1',
      title: 'Plan v2',
      blocks: [{ type: 'paragraph' }],
      tags: ['project', 'urgent'],
    })
    expect(store.saveState).toBe('saved')
    expect(store.documents.find((doc) => doc.id === 'd-1').updated_at).toBe('t1')
    expect(store.documents.find((doc) => doc.id === 'd-1').tags).toEqual(['project', 'urgent'])
  })

  it('marks the save state on a failed flush', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    stubFetch({ PATCH: fail })

    store.scheduleContentSave('d-1', { title: 'Doomed' })
    await vi.runAllTimersAsync()

    expect(store.saveState).toBe('error')
  })

  it('serializes overlapping saves and keeps the newer local content', async () => {
    store.documents = structuredClone(DOCS)
    store.openDoc = { ...structuredClone(DOCS[0]), blocks: [] }
    let resolveFirst
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = stubFetch({
      PATCH: (url, body) =>
        body.title === 'First'
          ? firstResponse
          : ok({ document: { id: body.id, title: body.title, updated_at: 't2' } }),
    })

    store.scheduleContentSave('d-1', { title: 'First' })
    const firstFlush = store.flushPendingSave()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    store.scheduleContentSave('d-1', { title: 'Second' })
    const secondFlush = store.flushPendingSave()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.openDoc.title).toBe('Second')

    resolveFirst(ok({ document: { id: 'd-1', title: 'First', updated_at: 't1' } }))
    await Promise.all([firstFlush, secondFlush])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).title).toBe('Second')
    expect(store.documents[0].title).toBe('Second')
    expect(store.openDoc.title).toBe('Second')
    expect(store.saveState).toBe('saved')
  })

  it('drops a deleted folder’s documents back to the root locally', async () => {
    store.folders = [
      ...structuredClone(FOLDERS),
      { id: 'f-2', parent_id: 'f-1', title: 'Nested', emoji: '📁' },
    ]
    store.documents = structuredClone(DOCS)
    stubFetch({ DELETE: () => ok({ ok: true }) })

    await store.deleteFolder('f-1')

    expect(store.folders).toHaveLength(0)
    expect(store.documents.find((doc) => doc.id === 'd-1').folder_id).toBe(null)
  })

  it('opens today’s note, creating Daily/2026/Aug and a Tasks heading when none exist', async () => {
    vi.setSystemTime(new Date(2026, 7, 13))
    const fetchMock = stubFetch({
      GET: (url) =>
        url.includes('/tasks/daily-note-seed')
          ? ok({ blocks: [] })
          : ok({ folders: [], documents: [] }),
      POST: (url, body) =>
        body.kind === 'folder'
          ? ok({
              folder: {
                id: `f-${body.title}`,
                parent_id: body.parentId,
                title: body.title,
                emoji: '📁',
              },
            })
          : ok({
              document: {
                id: 'd-today',
                folder_id: body.folderId,
                title: body.title,
                emoji: '🔹',
                starred: false,
              },
            }),
      PATCH: (url, body) => ok({ document: { id: body.id, updated_at: 't1' } }),
    })

    const doc = await store.openTodayNote()

    expect(doc.id).toBe('d-today')
    expect(doc.title).toBe('13-08-26')
    expect(store.folders).toContainEqual({
      id: 'f-Daily',
      parent_id: null,
      title: 'Daily',
      emoji: '📁',
    })
    expect(store.folders).toContainEqual({
      id: 'f-2026',
      parent_id: 'f-Daily',
      title: '2026',
      emoji: '📁',
    })
    expect(store.folders).toContainEqual({
      id: 'f-Aug',
      parent_id: 'f-2026',
      title: 'Aug',
      emoji: '📁',
    })

    // [0] loadWorkspace GET, [1] loadDailyNoteSeed GET, [2-4] Daily/2026/Aug
    // folder POSTs, [5] the document POST, [6] the seeding PATCH.
    const dailyCall = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(dailyCall).toMatchObject({ kind: 'folder', title: 'Daily', parentId: null })
    const yearCall = JSON.parse(fetchMock.mock.calls[3][1].body)
    expect(yearCall).toMatchObject({ kind: 'folder', title: '2026', parentId: 'f-Daily' })
    const monthCall = JSON.parse(fetchMock.mock.calls[4][1].body)
    expect(monthCall).toMatchObject({ kind: 'folder', title: 'Aug', parentId: 'f-2026' })
    const docCall = JSON.parse(fetchMock.mock.calls[5][1].body)
    expect(docCall).toMatchObject({ kind: 'document', folderId: 'f-Aug', title: '13-08-26' })
    const patchCall = JSON.parse(fetchMock.mock.calls[6][1].body)
    expect(patchCall).toEqual({
      id: 'd-today',
      blocks: [{ type: 'header', data: { text: 'Tasks', level: 2 } }],
    })
  })

  it('seeds a new daily note with the customized default instead of the built-in Tasks heading', async () => {
    vi.setSystemTime(new Date(2026, 7, 13))
    const customSeed = [{ type: 'paragraph', data: { text: 'Standup notes' } }]
    const fetchMock = stubFetch({
      GET: (url) =>
        url.includes('/tasks/daily-note-seed')
          ? ok({ blocks: customSeed })
          : ok({
              folders: [
                { id: 'f-daily', parent_id: null, title: 'Daily', emoji: '📁' },
                { id: 'f-year', parent_id: 'f-daily', title: '2026', emoji: '📁' },
                { id: 'f-month', parent_id: 'f-year', title: 'Aug', emoji: '📁' },
              ],
              documents: [],
            }),
      POST: (url, body) => ok({ document: { id: 'd-today', folder_id: body.folderId, title: body.title } }),
      PATCH: (url, body) => ok({ document: { id: body.id, updated_at: 't1' } }),
    })

    await store.openTodayNote()

    const patchCall = JSON.parse(fetchMock.mock.calls.at(-1)[1].body)
    expect(patchCall).toEqual({ id: 'd-today', blocks: customSeed })
  })

  it('reopens today’s existing note instead of creating a duplicate', async () => {
    vi.setSystemTime(new Date(2026, 7, 13))
    const fetchMock = stubFetch({
      GET: (url) =>
        url.includes('/tasks/daily-note-seed')
          ? ok({ blocks: [] })
          : ok({
              folders: [
                { id: 'f-daily', parent_id: null, title: 'Daily', emoji: '📁' },
                { id: 'f-year', parent_id: 'f-daily', title: '2026', emoji: '📁' },
                { id: 'f-month', parent_id: 'f-year', title: 'Aug', emoji: '📁' },
              ],
              documents: [{ id: 'd-today', folder_id: 'f-month', title: '13-08-26', starred: false }],
            }),
    })

    const doc = await store.openTodayNote()

    expect(doc.id).toBe('d-today')
    // loadWorkspace + loadDailyNoteSeed only — no folder/document creation
    // or seeding PATCH since today's note already exists.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loadDailyNoteSeed fetches once and is memoized', async () => {
    const fetchMock = stubFetch({ GET: () => ok({ blocks: [{ type: 'paragraph', data: {} }] }) })

    await store.loadDailyNoteSeed()
    await store.loadDailyNoteSeed()

    expect(store.dailyNoteSeed).toEqual([{ type: 'paragraph', data: {} }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('saveDailyNoteSeed persists blocks and updates local state', async () => {
    const blocks = [{ type: 'paragraph', data: { text: 'Weekly review' } }]
    const fetchMock = stubFetch({ PUT: (url, body) => ok({ blocks: body.blocks }) })

    const result = await store.saveDailyNoteSeed(blocks)

    expect(result).toBe(true)
    expect(store.dailyNoteSeed).toEqual(blocks)
    expect(fetchMock.mock.calls[0][0]).toBe(`${TASKS_API_URL}/tasks/daily-note-seed`)
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
  })

  it('saveDailyNoteSeed reports failure via a toast and returns false', async () => {
    stubFetch({ PUT: fail })

    const result = await store.saveDailyNoteSeed([])

    expect(result).toBe(false)
    expect(useInboxStore().notify).toHaveBeenCalledWith(
      'Failed to save the daily note default.',
      'error',
    )
  })

  it('searches documents into a separate array, leaving `documents` untouched', async () => {
    store.documents = structuredClone(DOCS)
    const results = [{ id: 'd-2', folder_id: null, title: 'Scratch', starred: true, tags: ['home'] }]
    const fetchMock = stubFetch({ GET: () => ok({ documents: results }) })

    await store.searchDocuments('scratch')

    expect(store.activeSearchQuery).toBe('scratch')
    expect(store.searchResults).toEqual(results)
    expect(store.documents).toHaveLength(2)
    expect(fetchMock.mock.calls[0][0]).toBe(`${TASKS_API_URL}/documents?q=scratch`)
  })

  it('appends mode=keyword for a non-semantic search', async () => {
    const fetchMock = stubFetch({ GET: () => ok({ documents: [] }) })

    await store.searchDocuments('scratch', { semantic: false })

    expect(fetchMock.mock.calls[0][0]).toBe(`${TASKS_API_URL}/documents?q=scratch&mode=keyword`)
  })

  it('ignores a stale search response superseded by a newer search', async () => {
    let resolveFirst
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    stubFetch({
      GET: (url) =>
        url.includes('first') ? firstResponse : ok({ documents: [{ id: 'd-2' }] }),
    })

    const firstSearch = store.searchDocuments('first')
    await store.searchDocuments('second')
    resolveFirst(ok({ documents: [{ id: 'd-stale' }] }))
    await firstSearch

    expect(store.activeSearchQuery).toBe('second')
    expect(store.searchResults).toEqual([{ id: 'd-2' }])
  })

  it('clearSearch resets search state without touching documents', async () => {
    store.documents = structuredClone(DOCS)
    stubFetch({ GET: () => ok({ documents: [{ id: 'd-2' }] }) })
    await store.searchDocuments('scratch')

    store.clearSearch()

    expect(store.activeSearchQuery).toBe('')
    expect(store.searchResults).toEqual([])
    expect(store.documents).toHaveLength(2)
  })

  it('surfaces a toast and leaves prior results in place when the search request fails', async () => {
    stubFetch({ GET: fail })

    await store.searchDocuments('scratch')

    expect(store.activeSearchQuery).toBe('')
    expect(store.searchResults).toEqual([])
    expect(useInboxStore().notify).toHaveBeenCalledWith('Search failed. Please try again.', 'error')
  })

  it('clears the open document when it is deleted', async () => {
    store.documents = structuredClone(DOCS)
    store.openDocId = 'd-1'
    store.openDoc = { id: 'd-1', blocks: [] }
    stubFetch({ DELETE: () => ok({ ok: true }) })

    await store.deleteDocument('d-1')

    expect(store.openDocId).toBe(null)
    expect(store.openDoc).toBe(null)
    expect(store.documents.map((doc) => doc.id)).toEqual(['d-2'])
  })
})
