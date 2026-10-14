import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TASKS_API_URL } from '../../lib/apiWorkers'
import { useInboxStore } from '../inbox'
import { useTaskFiltersStore } from '../taskFilters'

const FILTER = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Urgent',
  match: 'all',
  rules: [{ field: 'priority', value: 1, negate: false }],
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const failure = (status, body) => ({ ok: false, status, json: async () => body })

let store
let notify

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskFiltersStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  notify = vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => 1)
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('22222222-2222-4222-8222-222222222222')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

// Every PUT the store sends, parsed.
function puts() {
  return fetch.mock.calls
    .filter(([, options]) => options?.method === 'PUT')
    .map(([, options]) => JSON.parse(options.body))
}

describe('task filters store', () => {
  it('loads the document once from the tasks Worker', async () => {
    stubFetch(async () => ok({ revision: 3, filters: [FILTER] }))

    expect(await store.loadFilters()).toBe(true)
    await store.loadFilters()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(`${TASKS_API_URL}/task-filters`)
    expect(store.revision).toBe(3)
    expect(store.filters).toEqual([FILTER])
    expect(store.byId(FILTER.id)).toEqual(FILTER)
  })

  it('reads an empty list when the document has none yet', async () => {
    stubFetch(async () => ok({}))
    await store.loadFilters()
    expect(store.filters).toEqual([])
    expect(store.revision).toBe(0)
    expect(store.isLoaded).toBe(true)
  })

  it('tells the person when the load fails', async () => {
    stubFetch(async () => failure(500, { error: 'Request failed' }))
    expect(await store.loadFilters()).toBe(false)
    expect(store.isLoaded).toBe(false)
    expect(notify).toHaveBeenCalledWith('Request failed', 'error', null)
  })

  it('creates a filter by sending the whole list at the loaded revision', async () => {
    stubFetch(async (_url, options = {}) =>
      options.method === 'PUT'
        ? ok({ revision: 2, filters: JSON.parse(options.body).filters })
        : ok({ revision: 1, filters: [] }),
    )

    const created = await store.createFilter({
      name: '  Urgent ',
      match: 'any',
      rules: [{ field: 'priority', value: 1, negate: 'yes', extra: true }],
    })

    expect(created).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Urgent',
      match: 'any',
      rules: [{ field: 'priority', value: 1, negate: false }],
    })
    expect(puts()).toEqual([{ revision: 1, filters: [created] }])
    expect(store.revision).toBe(2)
    expect(store.filters).toEqual([created])
  })

  it('updates one filter in place and renames through the same path', async () => {
    stubFetch(async (_url, options = {}) =>
      options.method === 'PUT'
        ? ok({ revision: 2, filters: JSON.parse(options.body).filters })
        : ok({ revision: 1, filters: [FILTER] }),
    )

    const renamed = await store.renameFilter(FILTER.id, 'Fires')

    expect(renamed).toEqual({ ...FILTER, name: 'Fires' })
    expect(puts()[0].filters).toEqual([{ ...FILTER, name: 'Fires' }])
    expect(store.filters[0].name).toBe('Fires')
  })

  it('refuses to update a filter that is gone', async () => {
    stubFetch(async () => ok({ revision: 1, filters: [] }))
    expect(await store.updateFilter(FILTER.id, { name: 'Fires' })).toBeNull()
    expect(store.error).toBe('This filter was deleted in another session.')
    expect(puts()).toEqual([])
  })

  it('deletes a filter and can put it back where it was', async () => {
    const other = { ...FILTER, id: '33333333-3333-4333-8333-333333333333', name: 'Other' }
    let revision = 1
    stubFetch(async (_url, options = {}) =>
      options.method === 'PUT'
        ? ok({ revision: ++revision, filters: JSON.parse(options.body).filters })
        : ok({ revision: 1, filters: [FILTER, other] }),
    )

    const removed = await store.deleteFilter(FILTER.id)
    expect(removed).toEqual({ filter: FILTER, index: 0 })
    expect(store.filters).toEqual([other])

    expect(await store.restoreFilter(removed.filter, removed.index)).toBe(true)
    expect(store.filters).toEqual([FILTER, other])
    expect(puts().at(-1)).toEqual({ revision: 2, filters: [FILTER, other] })
  })

  it('reloads the latest list and applies the change again after a conflict', async () => {
    const elsewhere = { ...FILTER, id: '33333333-3333-4333-8333-333333333333', name: 'Elsewhere' }
    let gets = 0
    stubFetch(async (_url, options = {}) => {
      if (options.method !== 'PUT') {
        gets++
        return ok(gets === 1 ? { revision: 1, filters: [] } : { revision: 5, filters: [elsewhere] })
      }
      const body = JSON.parse(options.body)
      return body.revision === 5
        ? ok({ revision: 6, filters: body.filters })
        : failure(409, { error: 'Saved filters changed in another session' })
    })

    const created = await store.createFilter(FILTER)

    expect(created).toMatchObject({ name: 'Urgent' })
    expect(puts().map((body) => body.revision)).toEqual([1, 5])
    expect(store.filters).toEqual([elsewhere, created])
    expect(store.revision).toBe(6)
    expect(store.error).toBe('')
  })

  it('keeps the server reason when a save is refused', async () => {
    stubFetch(async (_url, options = {}) =>
      options.method === 'PUT'
        ? failure(400, { error: 'Saved-filter names must be unique.' })
        : ok({ revision: 1, filters: [FILTER] }),
    )

    expect(await store.createFilter({ ...FILTER, id: undefined })).toBeNull()
    expect(store.error).toBe('Saved-filter names must be unique.')
    expect(store.filters).toEqual([FILTER])
  })

  it('opens the editor with a fresh draft or a copy of a filter', () => {
    stubFetch(async () => ok({ revision: 0, filters: [] }))

    store.openEditor()
    expect(store.editor).toEqual({
      mode: 'create',
      id: null,
      name: '',
      match: 'all',
      rules: [{ field: 'due', value: 'today', negate: false }],
    })

    store.openEditor({ filter: FILTER })
    expect(store.editor).toEqual({ mode: 'edit', id: FILTER.id, ...FILTER })
    store.editor.rules[0].value = 2
    expect(FILTER.rules[0].value).toBe(1)

    store.closeEditor()
    expect(store.editor).toBeNull()
  })
})
