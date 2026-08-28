import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectsStore } from '../projects'
import { useInboxStore } from '../inbox'

const PROJECT = { id: 'p1', parentId: null, name: 'Work', createdAt: 't0' }

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useProjectsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

describe('projects store', () => {
  it('loads once and refetches only when forced', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ projects: [PROJECT] }) }))

    await store.loadProjects()
    await store.loadProjects()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.projects).toHaveLength(1)

    await store.loadProjects({ force: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('adds a created project to local state', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ project: PROJECT }) }))

    const created = await store.createProject({ name: 'Work' })

    expect(created.id).toBe('p1')
    expect(store.projects).toHaveLength(1)
  })

  // A rejected write must not leave the sidebar showing something the server
  // never accepted.
  it('rolls a failed rename back and notifies', async () => {
    store.projects = [{ ...PROJECT }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }))

    const result = await store.renameProject('p1', 'Renamed')

    expect(result).toBeNull()
    expect(store.projects[0].name).toBe('Work')
    expect(notify).toHaveBeenCalledWith('Failed to rename the project.', 'error')
  })

  it('sends the moved parentId in the request body', async () => {
    store.projects = [{ ...PROJECT }]
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ project: { ...PROJECT, parentId: 'p2' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const moved = await store.moveProject('p1', 'p2')

    expect(moved.parentId).toBe('p2')
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ id: 'p1', parentId: 'p2' })
  })

  it('removes a deleted project and its descendants from local state', async () => {
    store.projects = [{ ...PROJECT }, { id: 'p2', parentId: 'p1', name: 'API' }]
    stubFetch(async () => ({ ok: true, json: async () => ({ ok: true }) }))

    await store.deleteProject('p1')

    expect(store.projects).toEqual([])
  })
})
