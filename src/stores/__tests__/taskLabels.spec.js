import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskLabelsStore } from '../taskLabels'
import { useTaskItemsStore } from '../taskItems'
import { useInboxStore } from '../inbox'

const LABEL = { id: 'l1', name: 'home', color: '#1a73e8', taskCount: 2, createdAt: 't0' }

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskLabelsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

describe('task labels store', () => {
  it('loads once and refetches only when forced', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ labels: [LABEL] }) }))

    await store.loadLabels()
    await store.loadLabels()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://tasks-api.infinitywave.online/task-labels')
    expect(store.byName.get('home')).toEqual(LABEL)

    await store.loadLabels({ force: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('adds a created label in name order', async () => {
    store.labels = [{ ...LABEL, name: 'work' }]
    stubFetch(async () => ({ ok: true, json: async () => ({ label: LABEL }) }))

    const created = await store.createLabel({ name: 'home' })

    expect(created.id).toBe('l1')
    expect(store.labels.map((label) => label.name)).toEqual(['home', 'work'])
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: 'home' })
  })

  it('renames a label and rewrites it on loaded tasks', async () => {
    store.labels = [{ ...LABEL }]
    const items = useTaskItemsStore()
    items.items = [
      { id: 't1', labels: ['home', 'calls'] },
      { id: 't2', labels: ['work'] },
    ]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ label: { ...LABEL, name: 'house' } }),
    }))

    await store.renameLabel('l1', 'house')

    expect(store.labels[0].name).toBe('house')
    expect(store.labels[0].taskCount).toBe(2)
    expect(items.items[0].labels).toEqual(['house', 'calls'])
    expect(items.items[1].labels).toEqual(['work'])
  })

  it('rolls a failed rename back and notifies', async () => {
    store.labels = [{ ...LABEL }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({ ok: false, status: 409, json: async () => ({ error: 'taken' }) }))

    const result = await store.renameLabel('l1', 'work')

    expect(result).toBeNull()
    expect(store.labels[0].name).toBe('home')
    expect(notify).toHaveBeenCalledWith('taken', 'error')
  })

  it('recolours optimistically', async () => {
    store.labels = [{ ...LABEL }]
    let resolve
    stubFetch(() => new Promise((r) => (resolve = r)))

    const pending = store.recolourLabel('l1', '#2f9e44')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(store.labels[0].color).toBe('#2f9e44')
    resolve({ ok: true, json: async () => ({ label: { ...LABEL, color: '#2f9e44' } }) })
    await pending

    expect(store.labels[0].color).toBe('#2f9e44')
  })

  it('deletes a label and strips it from loaded tasks', async () => {
    store.labels = [{ ...LABEL }]
    const items = useTaskItemsStore()
    items.items = [{ id: 't1', labels: ['home', 'calls'] }]
    stubFetch(async () => ({ ok: true, json: async () => ({ ok: true }) }))

    expect(await store.deleteLabel('l1')).toBe(true)
    expect(store.labels).toEqual([])
    expect(items.items[0].labels).toEqual(['calls'])
  })

  it('restores a label whose delete failed', async () => {
    store.labels = [{ ...LABEL }]
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }))

    expect(await store.deleteLabel('l1')).toBe(false)
    expect(store.labels).toHaveLength(1)
  })

  it('keeps a label created while a failed delete was in flight', async () => {
    store.labels = [{ ...LABEL }, { ...LABEL, id: 'l2', name: 'work' }]
    let failDelete
    vi.spyOn(store, 'request').mockImplementation((method) =>
      method === 'DELETE'
        ? new Promise((_, reject) => (failDelete = reject))
        : Promise.resolve({ label: { ...LABEL, id: 'l3', name: 'admin' } }),
    )

    const deleting = store.deleteLabel('l1')
    await vi.waitFor(() => expect(failDelete).toBeDefined())
    await store.createLabel({ name: 'admin', color: '#1a73e8' })
    failDelete(new Error('boom'))

    expect(await deleting).toBe(false)
    expect(store.labels.map((label) => label.name)).toEqual(['admin', 'home', 'work'])
  })
})
