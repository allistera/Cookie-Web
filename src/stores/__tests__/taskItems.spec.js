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

  // A project switch must never show the previous project's tasks under the
  // new heading, whether the new load is merely slow or fails outright.
  describe('switching projects', () => {
    it('clears the list and disowns the loaded project before the fetch resolves', () => {
      store.items = [{ ...ITEM }]
      store.loadedProject = 'p1'
      stubFetch(() => new Promise(() => {})) // never resolves in this test

      store.loadItems('p2')

      expect(store.items).toEqual([])
      expect(store.loadedProject).toBeNull()
      expect(store.isLoading).toBe(true)
    })

    it('does not restore the previous tasks when the new load fails', async () => {
      store.items = [{ ...ITEM }]
      store.loadedProject = 'p1'
      const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
      stubFetch(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      }))

      await store.loadItems('p2')

      expect(store.items).toEqual([])
      expect(store.loadedProject).toBeNull()
      expect(notify).toHaveBeenCalled()
    })

    it('loads the new project normally once the fetch succeeds', async () => {
      store.items = [{ ...ITEM }]
      store.loadedProject = 'p1'
      const otherItem = { ...ITEM, id: 't2', projectId: 'p2' }
      stubFetch(async () => ({ ok: true, json: async () => ({ items: [otherItem] }) }))

      await store.loadItems('p2')

      expect(store.items).toEqual([otherItem])
      expect(store.loadedProject).toBe('p2')
    })
  })

  describe('countForProjects', () => {
    it('sums tasks, completed included, across every given project', async () => {
      stubFetch(async (url) => {
        const items = url.includes('project=p1') ? [{}, {}] : [{}]
        return { ok: true, json: async () => ({ items }) }
      })

      const total = await store.countForProjects(['p1', 'p2'])

      expect(total).toBe(3)
      expect(fetch).toHaveBeenCalledTimes(2)
      for (const [url] of fetch.mock.calls) {
        expect(url).toContain('completed=1')
      }
    })

    it('treats a project with no tasks as zero', async () => {
      stubFetch(async () => ({ ok: true, json: async () => ({ items: [] }) }))

      const total = await store.countForProjects(['p1'])

      expect(total).toBe(0)
    })
  })
})

describe('detail panel support', () => {
  it('finds a loaded item by id', () => {
    store.items = [{ ...ITEM }]

    expect(store.itemById('t1')).toMatchObject({ id: 't1', content: 'Ship it' })
    expect(store.itemById('missing')).toBeUndefined()
  })

  it('sends a description change and applies it locally', async () => {
    store.items = [{ ...ITEM, description: null }]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, description: 'Why' } }),
    }))

    await store.describeItem('t1', 'Why')

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ id: 't1', description: 'Why' })
    expect(store.items[0].description).toBe('Why')
  })

  it('sends a due date and applies it locally', async () => {
    store.items = [{ ...ITEM, dueDate: null }]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, dueDate: '2026-09-01' } }),
    }))

    await store.setDueDate('t1', '2026-09-01')

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ id: 't1', dueDate: '2026-09-01' })
    expect(store.items[0].dueDate).toBe('2026-09-01')
  })

  it('sends null to clear a due date', async () => {
    store.items = [{ ...ITEM, dueDate: '2026-09-01' }]
    stubFetch(async () => ({ ok: true, json: async () => ({ item: { ...ITEM, dueDate: null } }) }))

    await store.setDueDate('t1', null)

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ id: 't1', dueDate: null })
    expect(store.items[0].dueDate).toBeNull()
  })

  // The server refuses a malformed date rather than clearing it, so the
  // optimistic local value has to go back to what it was.
  it('rolls the due date back and surfaces the server message when refused', async () => {
    store.items = [{ ...ITEM, dueDate: '2026-09-01' }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'dueDate must be a YYYY-MM-DD date' }),
    }))

    await store.setDueDate('t1', 'nonsense')

    expect(store.items[0].dueDate).toBe('2026-09-01')
    expect(notify).toHaveBeenCalledWith('dueDate must be a YYYY-MM-DD date', 'error')
  })
})
