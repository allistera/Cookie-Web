import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentsStore } from '../documents'
import { useInboxStore } from '../../stores/inbox'
import { AI_API_URL, TASKS_API_URL } from '../../lib/apiWorkers'

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
    // Uploads send FormData; everything else sends a JSON string.
    const body =
      options.body instanceof FormData
        ? options.body
        : options.body
          ? JSON.parse(options.body)
          : undefined
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

  it('shares one in-flight loadWorkspace GET across concurrent callers', async () => {
    let resolveGet
    const pending = new Promise((resolve) => {
      resolveGet = resolve
    })
    const fetchMock = stubFetch({ GET: () => pending })

    const first = store.loadWorkspace()
    const second = store.loadWorkspace()

    resolveGet(ok({ folders: FOLDERS, documents: DOCS }))
    await Promise.all([first, second])

    expect(store.documents).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await store.loadWorkspace()
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('creates an AI document from the generated title and fills its blocks', async () => {
    const blocks = [{ type: 'paragraph', data: { text: 'Hello' } }]
    const fetchMock = stubFetch({
      POST: (url, body) =>
        String(url).startsWith(AI_API_URL)
          ? ok({ document: { title: 'Kitchen plan', blocks } })
          : ok({ document: { id: 'd-ai', folder_id: body.folderId, title: body.title } }),
      PATCH: () => ok({ document: { id: 'd-ai', updated_at: 't1' } }),
    })

    const doc = await store.createAiDocument({ folderId: 'f-1', instruction: 'Plan a kitchen' })

    expect(doc.id).toBe('d-ai')
    expect(store.documents[0].id).toBe('d-ai')
    expect(fetchMock.mock.calls[0][0]).toBe(`${AI_API_URL}/document`)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ instruction: 'Plan a kitchen' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      kind: 'document',
      folderId: 'f-1',
      title: 'Kitchen plan',
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ id: 'd-ai', blocks })
  })

  it('reports a failed AI generation without creating a document', async () => {
    const fetchMock = stubFetch({ POST: fail })

    const doc = await store.createAiDocument({ folderId: 'f-1', instruction: 'Plan a kitchen' })

    expect(doc).toBeNull()
    expect(store.documents).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(useInboxStore().notify).toHaveBeenCalledWith(
      'AI document failed. Please try again.',
      'error',
    )
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
      updatedAt: 't0',
    })
    expect(store.saveState).toBe('saved')
    expect(store.documents.find((doc) => doc.id === 'd-1').updated_at).toBe('t1')
    expect(store.documents.find((doc) => doc.id === 'd-1').tags).toEqual(['project', 'urgent'])
  })

  it('leaves the saved state as soon as the editor reports an edit', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    const fetchMock = stubFetch({
      PATCH: (url, body) => ok({ document: { id: body.id, updated_at: 't1' } }),
    })

    store.scheduleContentSave('d-1', { blocks: [{ type: 'paragraph' }] })
    await vi.runAllTimersAsync()
    expect(store.saveState).toBe('saved')

    // The editor debounces serialization, so this lands well before any
    // payload does. The status must not still read "saved" in that window.
    store.markContentDirty()
    expect(store.saveState).toBe('saving')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    store.scheduleContentSave('d-1', { blocks: [{ type: 'paragraph' }, { type: 'header' }] })
    await vi.runAllTimersAsync()
    expect(store.saveState).toBe('saved')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends openDoc updatedAt on a content PATCH', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    store.openDoc = { ...structuredClone(DOCS[0]), updated_at: 'open-t', blocks: [] }
    const fetchMock = stubFetch({
      PATCH: (url, body) => ok({ document: { id: body.id, updated_at: 't1' } }),
    })

    store.scheduleContentSave('d-1', { title: 'Plan v2' })
    await vi.runAllTimersAsync()

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      id: 'd-1',
      title: 'Plan v2',
      updatedAt: 'open-t',
    })
  })

  it('restores the pending save when content PATCH conflicts', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    store.openDoc = { ...structuredClone(DOCS[0]), blocks: [] }
    const fetchMock = stubFetch({
      PATCH: () => ({ ok: false, status: 409, json: async () => ({}) }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    store.scheduleContentSave('d-1', { title: 'Conflicted' })
    await vi.runAllTimersAsync()

    // A genuine conflict must retain the original version and draft.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.saveConflict).toBe(true)
    expect(store.saveState).toBe('error')

    await store.flushPendingSave()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).title).toBe('Conflicted')
    expect(store.saveState).toBe('error')
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

  it('moves a deleted folder’s documents into the root page and drops its pages', async () => {
    store.folders = structuredClone(FOLDERS)
    store.documents = structuredClone(DOCS)
    store.workspacePaged = true
    store.isLoaded = true
    store.pages = {
      '["root",false,null]': { ids: ['d-2'], loaded: true },
      '["f-1",false,null]': { ids: ['d-1'], loaded: true },
    }
    const unloaded = { ...DOCS[0], id: 'd-3', folder_id: null }
    stubFetch({
      DELETE: () => ok({ ok: true }),
      GET: () => ok({ documents: [DOCS[1], { ...DOCS[0], folder_id: null }, unloaded] }),
    })

    await store.deleteFolder('f-1')

    expect(store.pageFor({ folder: 'f-1' })).toBeUndefined()
    expect(
      store
        .documentsForPage({ folder: 'root' })
        .map((doc) => doc.id)
        .sort(),
    ).toEqual(['d-1', 'd-2', 'd-3'])
  })

  it('refetches the root page even when a root load was already in flight', async () => {
    store.folders = structuredClone(FOLDERS)
    store.documents = structuredClone(DOCS)
    store.workspacePaged = true
    store.isLoaded = true
    store.pages = {
      '["root",false,null]': { ids: ['d-2'], loaded: true },
      '["f-1",false,null]': { ids: ['d-1'], loaded: true },
    }
    const gets = []
    stubFetch({
      DELETE: () => ok({ ok: true }),
      GET: () => new Promise((resolve) => gets.push(resolve)),
    })
    const stale = store.loadDocumentPage({ folder: 'root' }, { force: true })
    await vi.waitFor(() => expect(gets).toHaveLength(1))

    const deleting = store.deleteFolder('f-1')
    await vi.waitFor(() => expect(gets).toHaveLength(2))
    gets[1](ok({ documents: [DOCS[1], { ...DOCS[0], folder_id: null }] }))
    await deleting
    gets[0](ok({ documents: [DOCS[1]] }))
    await stale

    expect(
      store
        .documentsForPage({ folder: 'root' })
        .map((doc) => doc.id)
        .sort(),
    ).toEqual(['d-1', 'd-2'])
  })

  it('returns null instead of throwing when the month folder cannot be created', async () => {
    store.isLoaded = true
    store.dailyNoteSeedLoaded = true
    const now = new Date()
    store.folders = [
      { id: 'daily', parent_id: null, title: 'Daily' },
      { id: 'year', parent_id: 'daily', title: String(now.getFullYear()) },
    ]
    stubFetch({ POST: fail })

    await expect(store.openTodayNote()).resolves.toBeNull()
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
      POST: (url, body) =>
        ok({ document: { id: 'd-today', folder_id: body.folderId, title: body.title } }),
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
              documents: [
                { id: 'd-today', folder_id: 'f-month', title: '13-08-26', starred: false },
              ],
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
    const results = [
      { id: 'd-2', folder_id: null, title: 'Scratch', starred: true, tags: ['home'] },
    ]
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
      GET: (url) => (url.includes('first') ? firstResponse : ok({ documents: [{ id: 'd-2' }] })),
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

  it('drops a queued edit for a deleted document instead of PATCHing it later', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    const fetchMock = stubFetch({ DELETE: () => ok({ ok: true }) })
    store.scheduleContentSave('d-1', { title: 'Unsaved' })

    expect(await store.deleteDocument('d-1')).toBe(true)
    await vi.runAllTimersAsync()

    expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['DELETE'])
    expect(store.saveState).toBe('saved')
  })

  it('requeues the dropped edit when the delete fails', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    const fetchMock = stubFetch({
      DELETE: fail,
      PATCH: (url, body) => ok({ document: { id: body.id, title: body.title, updated_at: 't1' } }),
    })
    store.scheduleContentSave('d-1', { title: 'Unsaved' })

    expect(await store.deleteDocument('d-1')).toBe(false)
    await vi.runAllTimersAsync()

    const patches = fetchMock.mock.calls.filter(([, options]) => options.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(JSON.parse(patches[0][1].body)).toMatchObject({ id: 'd-1', title: 'Unsaved' })
    expect(store.saveState).toBe('saved')
  })

  it('ignores an older meta PATCH that resolves after a newer one', async () => {
    store.documents = structuredClone(DOCS)
    const responses = []
    stubFetch({
      PATCH: (url, body) =>
        new Promise((resolve) => responses.push(() => resolve(ok({ document: { ...body } })))),
    })

    const first = store.toggleStar('d-1')
    const second = store.toggleStar('d-1')
    await vi.waitFor(() => expect(responses).toHaveLength(2))
    responses[1]()
    await second
    responses[0]()
    await first

    expect(store.documents.find((doc) => doc.id === 'd-1').starred).toBe(false)
  })

  it('does not roll back a newer meta change when an older PATCH fails', async () => {
    store.documents = structuredClone(DOCS)
    const responses = []
    stubFetch({
      PATCH: (url, body) =>
        new Promise((resolve) =>
          responses.push((failed) => resolve(failed ? fail() : ok({ document: { ...body } }))),
        ),
    })

    const first = store.updateDocumentMeta('d-1', { emoji: 'A' })
    const second = store.updateDocumentMeta('d-1', { emoji: 'B' })
    await vi.waitFor(() => expect(responses).toHaveLength(2))
    responses[1](false)
    await second
    responses[0](true)
    await first

    expect(store.documents.find((doc) => doc.id === 'd-1').emoji).toBe('B')
  })

  it('files a moved document on its new pages even when a newer meta call fails', async () => {
    store.documents = structuredClone(DOCS)
    store.workspacePaged = true
    store.pages = {
      '["root",false,null]': { ids: ['d-2'], loaded: true },
      '["f-1",false,null]': { ids: ['d-1'], loaded: true },
    }
    const responses = []
    stubFetch({
      PATCH: () =>
        new Promise((resolve) =>
          responses.push((failed) =>
            resolve(failed ? fail() : ok({ document: { ...DOCS[0], folder_id: null } })),
          ),
        ),
    })

    const move = store.moveDocument('d-1', null)
    const star = store.toggleStar('d-1')
    await vi.waitFor(() => expect(responses).toHaveLength(2))
    responses[1](true)
    await star
    responses[0](false)
    await move

    expect(store.pageFor({ folder: 'root' }).ids).toContain('d-1')
    expect(store.pageFor({ folder: 'f-1' }).ids).toEqual([])
  })

  it('drops an in-flight edit that fails after its document was deleted', async () => {
    store.documents = structuredClone(DOCS)
    let failPatch
    const fetchMock = stubFetch({
      DELETE: () => ok({ ok: true }),
      PATCH: () =>
        failPatch ? fail() : new Promise((resolve) => (failPatch = () => resolve(fail()))),
    })
    store.scheduleContentSave('d-1', { title: 'Unsaved' })
    const flush = store.flushPendingSave()
    await vi.waitFor(() => expect(failPatch).toBeDefined())

    expect(await store.deleteDocument('d-1')).toBe(true)
    failPatch()
    await flush

    expect(await store.flushPendingSave()).toBe(true)
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(1)
    expect(store.saveState).toBe('saved')
  })
})

describe('draft recovery', () => {
  it('blocks navigation after failure and saves the retained draft on retry', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    store.openDoc = { ...structuredClone(DOCS[0]), blocks: [] }
    store.openDocId = 'd-1'
    let unavailable = true
    const fetchMock = stubFetch({
      PATCH: (_, body) =>
        unavailable
          ? fail()
          : ok({ document: { id: body.id, title: body.title, updated_at: 't1' } }),
    })
    store.scheduleContentSave('d-1', { title: 'Keep this draft' })
    expect(await store.flushPendingSave()).toBe(false)
    expect(await store.openDocument('d-2')).toBe(false)
    expect(store.openDoc.title).toBe('Keep this draft')
    expect(store.openDocId).toBe('d-1')
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'PATCH')).toBe(true)
    unavailable = false
    expect(await store.flushPendingSave()).toBe(true)
    expect(store.openDoc.title).toBe('Keep this draft')
    expect(store.saveState).toBe('saved')
  })

  it('saves a conflicted draft to a new document without updating the original version', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    store.openDoc = {
      ...structuredClone(DOCS[0]),
      blocks: [{ type: 'paragraph', data: { text: 'Local work' } }],
    }
    store.scheduleContentSave('d-1', { title: 'Local title' })
    const requests = []
    vi.spyOn(store, 'request').mockImplementation(async (method, { body } = {}) => {
      requests.push({ method, body })
      if (body.id === 'd-1') throw Object.assign(new Error('Conflict'), { status: 409 })
      return { document: { id: 'copy-1', title: body.title, updated_at: 't2' } }
    })
    await store.flushPendingSave()
    const copy = await store.saveConflictAsCopy()
    expect(copy.id).toBe('copy-1')
    expect(requests.filter(({ body }) => body.id === 'd-1')).toHaveLength(1)
    expect(requests.at(-1).body.blocks[0].data.text).toBe('Local work')
    expect(await store.flushPendingSave()).toBe(true)
    expect(store.saveConflict).toBe(false)
  })
})

describe('paged document workspace', () => {
  it('keeps global metadata, deduplicates pages, and skips unchanged refreshes', async () => {
    const request = vi.spyOn(store, 'request').mockImplementation(async (_, { params }) => {
      const url = new URL(`https://fixture.invalid/${params}`)
      if (url.searchParams.get('view') === 'meta') {
        if (url.searchParams.has('version')) return { unchanged: true, version: '1' }
        return { folders: FOLDERS, tags: [{ name: 'unloaded', count: 200 }], version: '1' }
      }
      return { documents: DOCS, nextCursor: url.searchParams.has('before') ? null : 'next' }
    })
    await store.loadWorkspace()
    expect(store.documentTags).toEqual([{ name: 'unloaded', count: 200 }])
    expect(store.documentsForPage({})).toHaveLength(2)
    await store.loadDocumentPage({}, { more: true })
    expect(store.documentsForPage({})).toHaveLength(2)
    expect(store.pageFor({}).nextCursor).toBeNull()
    const calls = request.mock.calls.length
    await store.loadWorkspace({ force: true })
    expect(request.mock.calls.length).toBe(calls + 1)
    expect(store.documents).toHaveLength(2)
  })

  // The folder browser mounts beside the sidebar and asks for its folder's
  // page at once, while the sidebar's loadWorkspace is still in flight and
  // workspacePaged is still false. That request must not be lost.
  it('loads a folder page requested before the workspace finished loading', async () => {
    const request = vi.spyOn(store, 'request').mockImplementation(async (_, { params }) => {
      const url = new URL(`https://fixture.invalid/${params}`)
      if (url.searchParams.get('view') === 'meta') {
        return { folders: FOLDERS, tags: [], version: '1' }
      }
      return {
        documents: url.searchParams.get('folder') === 'f-1' ? [DOCS[1]] : [],
        nextCursor: null,
      }
    })

    const workspace = store.loadWorkspace()
    void store.loadDocumentPage({ folder: 'f-1' })
    await workspace

    expect(request.mock.calls.map(([, { params }]) => params)).toContain('?view=page&folder=f-1')
    expect(store.pageFor({ folder: 'f-1' })?.loaded).toBe(true)
    expect(store.documentsForPage({ folder: 'f-1' })).toHaveLength(1)
  })

  // A forced refresh after the workspace changed (an edit bumped the
  // revision, then the tab came back) rebuilds the pages. The folder on
  // screen must come back with them, not only the three default scopes.
  it('reloads the pages that were open when a changed workspace is refetched', async () => {
    let version = '1'
    const request = vi.spyOn(store, 'request').mockImplementation(async (_, { params }) => {
      const url = new URL(`https://fixture.invalid/${params}`)
      if (url.searchParams.get('view') === 'meta') {
        return { folders: FOLDERS, tags: [], version }
      }
      return {
        documents: url.searchParams.get('folder') === 'f-1' ? [DOCS[1]] : [],
        nextCursor: null,
      }
    })
    await store.loadWorkspace()
    await store.loadDocumentPage({ folder: 'f-1' })
    expect(store.documentsForPage({ folder: 'f-1' })).toHaveLength(1)

    version = '2'
    request.mockClear()
    await store.loadWorkspace({ force: true })

    expect(request.mock.calls.map(([, { params }]) => params)).toContain('?view=page&folder=f-1')
    expect(store.documentsForPage({ folder: 'f-1' })).toHaveLength(1)
  })

  it('updates paged membership and global tag counts after create, move and delete', async () => {
    store.workspacePaged = true
    store.workspaceTags = [{ name: 'home', count: 100 }]
    store.pages = {
      '[null,false,null]': { ids: [], loaded: true },
      '["root",false,null]': { ids: [], loaded: true },
      '["f-1",false,null]': { ids: [], loaded: true },
      '[null,true,null]': { ids: [], loaded: true },
    }
    const document = { ...DOCS[1], tags: ['home'] }
    store.documents = [document]
    store.syncDocumentPages(document)
    expect(store.documentsForPage({ folder: 'root' })).toHaveLength(1)
    expect(store.documentTags).toEqual([{ name: 'home', count: 101 }])
    const previous = { ...document }
    document.folder_id = 'f-1'
    document.starred = false
    store.syncDocumentPages(document, previous)
    expect(store.documentsForPage({ folder: 'root' })).toHaveLength(0)
    expect(store.documentsForPage({ folder: 'f-1' })).toHaveLength(1)
    expect(store.documentsForPage({ starred: true })).toHaveLength(0)
    store.syncDocumentPages(null, document)
    expect(store.documentsForPage({})).toHaveLength(0)
    expect(store.documentTags).toEqual([{ name: 'home', count: 100 }])
  })
})

describe('documents store — files', () => {
  const FILE = {
    id: 'x-1',
    folder_id: null,
    name: 'notes.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
    created_at: 't0',
    updated_at: 't0',
  }

  it('loads a folder page of files once and exposes it', async () => {
    const fetchMock = stubFetch({ GET: () => ok({ files: [FILE] }) })
    await store.loadFiles(null)
    await store.loadFiles(null)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${TASKS_API_URL}/files?folder=root`)
    expect(store.filesForFolder(null)).toEqual([FILE])
    expect(store.filePages.root.loaded).toBe(true)
  })

  it('records a failed load and notifies', async () => {
    stubFetch({ GET: fail })
    await store.loadFiles('f-1')
    expect(store.filePages['f-1'].error).toBeTruthy()
    expect(useInboxStore().notify).toHaveBeenCalled()
  })

  it('uploads with multipart form data into the folder page', async () => {
    const fetchMock = stubFetch({
      POST: () => ({
        ok: true,
        status: 201,
        json: async () => ({ file: { ...FILE, folder_id: 'f-1' } }),
      }),
    })
    store.filePages['f-1'] = { ids: [], loaded: true, loading: false, error: null }
    const file = new File(['hi'], 'notes.pdf', { type: 'application/pdf' })
    await store.uploadFiles([file], 'f-1')
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${TASKS_API_URL}/files`)
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('folder')).toBe('f-1')
    expect(store.filePages['f-1'].ids).toEqual(['x-1'])
    expect(store.uploads).toEqual([])
  })

  it('keeps a failed upload as a dismissable placeholder', async () => {
    stubFetch({
      POST: () => ({
        ok: false,
        status: 413,
        json: async () => ({ error: 'File is larger than 25 MB' }),
      }),
    })
    await store.uploadFiles([new File(['x'], 'a.bin')], null)
    expect(store.uploads).toHaveLength(1)
    expect(store.uploads[0]).toMatchObject({ status: 'error', error: 'File is larger than 25 MB' })
    store.dismissUpload(store.uploads[0].id)
    expect(store.uploads).toEqual([])
  })

  it('rejects oversized files before any request', async () => {
    const fetchMock = stubFetch({})
    const big = new File([new Uint8Array(1)], 'big.bin')
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 })
    await store.uploadFiles([big], null)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.uploads[0].error).toContain('25 MB')
  })

  it('renames optimistically and rolls back on failure', async () => {
    store.files['x-1'] = { ...FILE }
    stubFetch({ PATCH: fail })
    await store.renameFile('x-1', 'renamed.pdf')
    expect(store.files['x-1'].name).toBe('notes.pdf')
    expect(useInboxStore().notify).toHaveBeenCalled()
  })

  it('moves between loaded folder pages', async () => {
    store.files['x-1'] = { ...FILE }
    store.filePages.root = { ids: ['x-1'], loaded: true, loading: false, error: null }
    store.filePages['f-1'] = { ids: [], loaded: true, loading: false, error: null }
    stubFetch({ PATCH: (_url, body) => ok({ file: { ...FILE, folder_id: body.folder } }) })
    await store.moveFile('x-1', 'f-1')
    expect(store.filePages.root.ids).toEqual([])
    expect(store.filePages['f-1'].ids).toEqual(['x-1'])
    expect(store.files['x-1'].folder_id).toBe('f-1')
  })

  it('deletes optimistically and restores on failure', async () => {
    store.files['x-1'] = { ...FILE }
    store.filePages.root = { ids: ['x-1'], loaded: true, loading: false, error: null }
    stubFetch({ DELETE: fail })
    await store.deleteFile('x-1')
    expect(store.filePages.root.ids).toEqual(['x-1'])
    expect(store.files['x-1']).toBeDefined()
  })

  it('fetches content as a blob with auth headers', async () => {
    const blob = new Blob(['pdf'])
    const fetchMock = stubFetch({ GET: () => ({ ok: true, blob: async () => blob }) })
    await expect(store.fetchFileBlob('x-1')).resolves.toBe(blob)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${TASKS_API_URL}/files/x-1/content`)
  })

  it('forgets file pages when a folder is deleted', async () => {
    store.folders = [{ id: 'f-1', parent_id: null, title: 'A' }]
    store.filePages['f-1'] = { ids: [], loaded: true, loading: false, error: null }
    stubFetch({ DELETE: () => ({ ok: true, status: 204 }) })
    await store.deleteFolder('f-1')
    expect(store.filePages).toEqual({})
  })
})
