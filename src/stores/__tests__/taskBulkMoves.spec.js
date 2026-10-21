import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTaskItemsStore, TASK_PATCH } from '../taskItems'
import { useInboxStore } from '../inbox'
import { createOfflineDb, setOfflineDb } from '../../lib/offlineDb'
import { setOfflineOwner } from '../../lib/offlineCache'
import { pendingOutboxEntries, resetOutboxForTests } from '../../lib/outbox'

let store
beforeEach(() => {
  setActivePinia(createPinia())
  setOfflineDb(createOfflineDb({ indexedDB: new IDBFactory() }))
  setOfflineOwner('test-bulk-owner')
  resetOutboxForTests()
  store = useTaskItemsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  store.loadedProject = 'p1'
  store.items = ['a', 'b'].map((id) => ({ id, content: id, projectId: 'p1', parentId: null }))
})
afterEach(() => {
  setOfflineOwner(null)
  setOfflineDb(null)
  resetOutboxForTests()
  vi.unstubAllGlobals()
})
it('queues every offline move and does not reload away the optimistic result', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
  const reload = vi.spyOn(store, 'loadItems')
  expect(await store.moveItems(['a', 'b'], 'p2')).toBe(2)
  expect((await pendingOutboxEntries(TASK_PATCH)).map((entry) => entry.payload)).toEqual([
    { id: 'a', projectId: 'p2' },
    { id: 'b', projectId: 'p2' },
  ])
  expect(store.items).toEqual([])
  expect(reload).not.toHaveBeenCalled()
})
it('retains confirmed moves if the final reload fails', async () => {
  store.loadedProject = 'today'
  store.items.forEach((row) => {
    row.dueDate = '2020-01-01'
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (options.method === 'PATCH') {
        const patch = JSON.parse(options.body)
        return {
          ok: true,
          json: async () => ({
            item: { ...store.items.find((row) => row.id === patch.id), ...patch },
          }),
        }
      }
      return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }
    }),
  )
  expect(await store.moveItems(['a', 'b'], 'p2')).toBe(2)
  expect(store.items.map((row) => row.projectId)).toEqual(['p2', 'p2'])
  expect(store.loadedProject).toBe('today')
})
