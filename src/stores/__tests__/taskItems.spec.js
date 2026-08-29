import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskItemsStore } from '../taskItems'
import { useInboxStore } from '../inbox'

const ITEM = { id: 't1', projectId: 'p1', parentId: null, content: 'Ship it', completedAt: null }

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskItemsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

describe('task items store', () => {
  it('loads a project once, and refetches when the project changes', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [ITEM] }) }))

    await store.loadItems('p1')
    await store.loadItems('p1')
    expect(fetch).toHaveBeenCalledTimes(1)

    await store.loadItems('inbox')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('sends the project and content when creating', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ item: ITEM }) }))

    await store.createItem({ content: 'Ship it', projectId: 'p1' })

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ content: 'Ship it', projectId: 'p1' })
    expect(store.items).toHaveLength(1)
  })

  // Completing hides the task from the list without deleting it.
  it('drops a completed task from the visible list', async () => {
    store.items = [{ ...ITEM }]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, completedAt: '2026-08-29T10:00:00Z' } }),
    }))

    await store.setCompleted('t1', true)

    expect(store.items).toEqual([])
  })

  it('rolls a failed rename back and surfaces the server message', async () => {
    store.items = [{ ...ITEM }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Task content is required' }),
    }))

    const result = await store.renameItem('t1', '')

    expect(result).toBeNull()
    expect(store.items[0].content).toBe('Ship it')
    expect(notify).toHaveBeenCalledWith('Task content is required', 'error')
  })

  it('rolls a failed delete back and surfaces the server message', async () => {
    store.items = [{ ...ITEM }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Task not found' }),
    }))

    const result = await store.deleteItem('t1')

    expect(result).toBe(false)
    expect(store.items).toEqual([ITEM])
    expect(notify).toHaveBeenCalledWith('Task not found', 'error')
  })
})
