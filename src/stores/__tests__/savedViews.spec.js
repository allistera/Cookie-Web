import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuth0Client } from '../../auth0-client'
import { SEARCH_API_URL } from '../../lib/apiWorkers'
import {
  savedViewDraftFromQuery,
  savedViewMatchesRoute,
  savedViewNextPageQuery,
  savedViewPageState,
  savedViewPreviousPageQuery,
  savedViewRoute,
} from '../../lib/savedViews'
import { useSavedViewsStore } from '../savedViews'

const view = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Client mail',
  query: 'from:client@example.com',
  folder: 'inbox',
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const failure = (status, body) => ({ ok: false, status, json: async () => body })

let store

beforeEach(() => {
  setActivePinia(createPinia())
  setAuth0Client({ getAccessTokenSilently: vi.fn().mockResolvedValue('token') })
  store = useSavedViewsStore()
  store.setOwner('account-a')
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAuth0Client(null)
})

describe('saved views store', () => {
  it('loads one account document and sends its revision with a full-list save', async () => {
    const fetchMock = vi.fn(async (_url, options = {}) =>
      options.method === 'PUT'
        ? ok({ revision: 2, views: [view] })
        : ok({ revision: 1, views: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await store.load()
    expect(store.revision).toBe(1)
    expect(await store.save([view])).toBe(true)
    expect(store.views).toEqual([view])
    expect(fetchMock.mock.calls[0][0]).toBe(`${SEARCH_API_URL}/saved-views`)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ revision: 1, views: [view] })
  })

  it('keeps the caller draft on conflict and exposes the latest server revision', async () => {
    const draft = [{ ...view, name: 'My unsaved name' }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options = {}) =>
        options.method === 'PUT'
          ? failure(409, { current: { revision: 2, views: [view] } })
          : ok({ revision: 1, views: [] }),
      ),
    )

    await store.load()
    expect(await store.save(draft)).toBe(false)
    expect(store.conflict).toBe(true)
    expect(store.revision).toBe(2)
    expect(store.views).toEqual([view])
    expect(draft[0].name).toBe('My unsaved name')
    expect(store.error).toContain('Your edits are still here')
  })

  it('retains the draft and previous document when a save fails', async () => {
    const draft = [{ ...view, name: 'Keep this edit' }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options = {}) =>
        options.method === 'PUT'
          ? failure(503, { error: 'Search is unavailable' })
          : ok({ revision: 1, views: [view] }),
      ),
    )

    await store.load()
    expect(await store.save(draft)).toBe(false)
    expect(store.views[0].name).toBe('Client mail')
    expect(draft[0].name).toBe('Keep this edit')
    expect(store.error).toContain('Search is unavailable')
  })

  it('clears account data and ignores an old account load response', async () => {
    let resolveOld
    const oldResponse = new Promise((resolve) => {
      resolveOld = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => oldResponse)
        .mockResolvedValueOnce(ok({ revision: 0, views: [] })),
    )

    const oldLoad = store.load()
    await Promise.resolve()
    await Promise.resolve()
    store.setOwner('account-b')
    await store.load()
    resolveOld(ok({ revision: 5, views: [view] }))
    await oldLoad

    expect(store.ownerSub).toBe('account-b')
    expect(store.views).toEqual([])
    expect(store.revision).toBe(0)
  })

  it('ignores an old account save response after switching owners', async () => {
    let resolveSave
    const pendingResponse = new Promise((resolve) => {
      resolveSave = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ revision: 0, views: [] }))
        .mockImplementationOnce(() => pendingResponse),
    )

    await store.load()
    const save = store.save([view])
    await Promise.resolve()
    await Promise.resolve()
    store.setOwner(null)
    resolveSave(ok({ revision: 1, views: [view] }))
    expect(await save).toBe(false)
    expect(store.views).toEqual([])
    expect(store.loaded).toBe(false)
  })
})

describe('saved view navigation', () => {
  it('uses the existing paginated, mail-only keyword route', () => {
    const target = savedViewRoute(view)
    expect(target).toEqual({
      name: 'search',
      query: {
        q: 'from:client@example.com in:inbox',
        scope: 'mail',
        mode: 'keyword',
        view: view.id,
      },
    })
    expect(savedViewMatchesRoute(view, target)).toBe(true)
    expect(savedViewMatchesRoute(view, { query: { ...target.query, q: 'other' } })).toBe(false)
  })

  it('moves an existing in: folder out of the search query for the save form', () => {
    expect(savedViewDraftFromQuery('in:done floor plan')).toEqual({
      query: 'floor plan',
      folder: 'done',
    })
  })

  it('does not extract in: from a quoted tag value', () => {
    expect(savedViewDraftFromQuery('tag:"Project in:inbox Plans"')).toEqual({
      query: 'tag:"Project in:inbox Plans"',
      folder: 'all',
    })
    expect(savedViewDraftFromQuery('tag:"Project in:inbox Plans" in:sent')).toEqual({
      query: 'tag:"Project in:inbox Plans"',
      folder: 'sent',
    })
  })

  it('carries verified search cursors forward and backward without changing mail keyword scope', () => {
    const first = { ...savedViewRoute(view).query }
    const second = savedViewNextPageQuery(first, 23)
    expect(second).toEqual({ ...first, cursor: '23', trail: '0' })
    const third = savedViewNextPageQuery(second, 47)
    expect(third).toEqual({ ...first, cursor: '47', trail: '0,23' })
    expect(savedViewPageState(third)).toEqual({ offset: 47, trail: [0, 23] })
    expect(savedViewPreviousPageQuery(third)).toEqual(second)
    expect(savedViewPreviousPageQuery(second)).toEqual(first)
  })

  it('rejects malformed or excessive cursor and trail input from a shared URL', () => {
    expect(savedViewPageState({ cursor: '-1', trail: '0' })).toEqual({ offset: 0, trail: [] })
    expect(savedViewPageState({ cursor: '1000', trail: '0' })).toEqual({ offset: 0, trail: [] })
    expect(savedViewPageState({ cursor: '23', trail: '23,0' })).toEqual({ offset: 0, trail: [] })
    expect(savedViewPageState({ cursor: ['23'], trail: '0' })).toEqual({ offset: 0, trail: [] })
    expect(
      savedViewPageState({
        cursor: '999',
        trail: Array.from({ length: 51 }, (_, index) => String(index)).join(','),
      }),
    ).toEqual({ offset: 0, trail: [] })
    expect(savedViewNextPageQuery({ cursor: '23', trail: '0' }, 23)).toBeNull()
    expect(savedViewNextPageQuery({ cursor: '23', trail: '0' }, 1000)).toBeNull()
  })
})
