import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentsStore } from '../documents'
import { useInboxStore } from '../../stores/inbox'

const FOLDERS = [{ id: 'f-1', parent_id: null, title: 'Projects', emoji: '📁' }]
const DOCS = [
  { id: 'd-1', folder_id: 'f-1', title: 'Plan', emoji: '🔹', starred: false, updated_at: 't0' },
  { id: 'd-2', folder_id: null, title: 'Scratch', emoji: '🔹', starred: true, updated_at: 't0' },
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

  it('rolls an optimistic star back when the PATCH fails', async () => {
    store.documents = structuredClone(DOCS)
    stubFetch({ PATCH: fail })

    await store.toggleStar('d-1')

    expect(store.documents.find((doc) => doc.id === 'd-1').starred).toBe(false)
  })

  it('debounces content saves and PATCHes title and blocks together', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    const fetchMock = stubFetch({
      PATCH: (url, body) => ok({ document: { id: body.id, updated_at: 't1' } }),
    })

    store.scheduleContentSave('d-1', { title: 'Plan v2' })
    store.scheduleContentSave('d-1', { blocks: [{ type: 'paragraph' }] })
    expect(store.saveState).toBe('saving')
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent).toEqual({ id: 'd-1', title: 'Plan v2', blocks: [{ type: 'paragraph' }] })
    expect(store.saveState).toBe('saved')
    expect(store.documents.find((doc) => doc.id === 'd-1').updated_at).toBe('t1')
  })

  it('marks the save state on a failed flush', async () => {
    vi.useFakeTimers()
    store.documents = structuredClone(DOCS)
    stubFetch({ PATCH: fail })

    store.scheduleContentSave('d-1', { title: 'Doomed' })
    await vi.runAllTimersAsync()

    expect(store.saveState).toBe('error')
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
