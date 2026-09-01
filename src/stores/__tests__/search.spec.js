import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSearchStore } from '../search'
import { useInboxStore } from '../inbox'
import { SEARCH_API_URL } from '../../lib/apiWorkers'

function stubFetch(routes) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    const handler = routes[method]
    if (!handler) throw new Error(`Unexpected fetch: ${method} ${url}`)
    return handler(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const ok = (payload) => ({ ok: true, json: async () => payload })
const fail = (status) => ({ ok: false, status, json: async () => ({}) })

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useSearchStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('search store', () => {
  it('fetches combined results and stores paging metadata', async () => {
    const results = [
      { type: 'email', id: 'e-1', subject: 'Hello', from_address: 'a@b.com', sent_at: 't0' },
      { type: 'document', id: 'd-1', title: 'Plan', tags: ['work'], starred: false, updated_at: 1 },
    ]
    const fetchMock = stubFetch({
      GET: () => ok({ query: 'plan', results, estimatedTotalHits: 2, limit: 20, offset: 0 }),
    })

    await store.search('plan')

    expect(store.query).toBe('plan')
    expect(store.scope).toBe('all')
    expect(store.results).toEqual(results)
    expect(store.estimatedTotalHits).toBe(2)
    expect(store.error).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${SEARCH_API_URL}/search?q=plan&scope=all&limit=20&offset=0`,
    )
  })

  it('passes scope, mode, limit, and offset through to the request', async () => {
    const fetchMock = stubFetch({ GET: () => ok({ results: [] }) })

    await store.search('plan', { scope: 'documents', mode: 'keyword', limit: 10, offset: 10 })

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${SEARCH_API_URL}/search?q=plan&scope=documents&limit=10&offset=10&mode=keyword`,
    )
  })

  it('ignores a stale response superseded by a newer search', async () => {
    let resolveFirst
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    stubFetch({
      GET: (url) =>
        url.includes('first') ? firstResponse : ok({ query: 'second', results: [{ id: 'r-2' }] }),
    })

    const firstSearch = store.search('first')
    await store.search('second')
    resolveFirst(ok({ query: 'first', results: [{ id: 'stale' }] }))
    await firstSearch

    expect(store.query).toBe('second')
    expect(store.results).toEqual([{ id: 'r-2' }])
  })

  it('sets a 503 error as "unavailable"', async () => {
    stubFetch({ GET: () => fail(503) })

    await store.search('plan')

    expect(store.error).toBe('unavailable')
    expect(store.results).toEqual([])
  })

  it('sets a 400 error as "invalid"', async () => {
    stubFetch({ GET: () => fail(400) })

    await store.search('a')

    expect(store.error).toBe('invalid')
  })

  it('sets any other failure as "failed"', async () => {
    stubFetch({ GET: () => fail(500) })

    await store.search('plan')

    expect(store.error).toBe('failed')
  })

  it('clear() resets state and invalidates any in-flight request', async () => {
    let resolvePending
    stubFetch({
      GET: () =>
        new Promise((resolve) => {
          resolvePending = resolve
        }),
    })

    const pending = store.search('plan')
    await Promise.resolve() // let search() reach its fetch() call before clearing
    store.clear()
    resolvePending(ok({ query: 'plan', results: [{ id: 'e-1' }] }))
    await pending

    expect(store.query).toBe('')
    expect(store.results).toEqual([])
    expect(store.estimatedTotalHits).toBe(0)
    expect(store.loading).toBe(false)
  })

  it('a blank query clears state without making a request', async () => {
    const fetchMock = stubFetch({ GET: () => ok({ results: [] }) })
    store.results = [{ id: 'e-1' }]

    await store.search('   ')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.results).toEqual([])
  })
})
