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

  // The server rejects a drop that would make a project its own descendant
  // with a 400 and an explanatory body. That message is the whole point of
  // the cycle check, so a rolled-back move must surface it verbatim rather
  // than a generic failure the user could mistake for transient.
  it('rolls a failed move back and notifies with the server message', async () => {
    store.projects = [{ ...PROJECT, parentId: 'root' }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'A project cannot become its own descendant' }),
    }))

    const result = await store.moveProject('p1', 'p2')

    expect(result).toBeNull()
    expect(store.projects[0].parentId).toBe('root')
    expect(notify).toHaveBeenCalledWith('A project cannot become its own descendant', 'error')
  })

  it('rolls a failed delete back to the whole subtree, not just the addressed row', async () => {
    const subtree = [
      { ...PROJECT },
      { id: 'p2', parentId: 'p1', name: 'Clients' },
      { id: 'p3', parentId: 'p2', name: 'Acme' },
    ]
    store.projects = subtree
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }))

    const result = await store.deleteProject('p1')

    expect(result).toBe(false)
    expect(store.projects).toEqual(subtree)
    expect(notify).toHaveBeenCalledWith('Failed to delete the project.', 'error')
  })

  it('keeps a project created while a failed delete was in flight', async () => {
    const other = { id: 'p0', parentId: null, name: 'Home' }
    store.projects = [other, { ...PROJECT }, { id: 'p2', parentId: 'p1', name: 'Clients' }]
    let failDelete
    vi.spyOn(store, 'request').mockImplementation((method) =>
      method === 'DELETE'
        ? new Promise((_, reject) => (failDelete = reject))
        : Promise.resolve({ project: { id: 'p9', parentId: null, name: 'New' } }),
    )

    const deleting = store.deleteProject('p1')
    await vi.waitFor(() => expect(failDelete).toBeDefined())
    await store.createProject({ name: 'New' })
    failDelete(new Error('boom'))

    expect(await deleting).toBe(false)
    expect(store.projects.map((project) => project.id)).toEqual(['p0', 'p1', 'p2', 'p9'])
  })
})

it('shares concurrent loads and applies a create after the old snapshot resolves', async () => {
  let resolveLoad
  const request = vi.spyOn(store, 'request').mockImplementation((method) =>
    method === 'GET'
      ? new Promise((resolve) => {
          resolveLoad = resolve
        })
      : Promise.resolve({ project: { ...PROJECT, id: 'p2' } }),
  )
  const first = store.loadProjects()
  const second = store.loadProjects()
  const create = store.createProject({ name: 'New' })
  expect(request).toHaveBeenCalledTimes(1)
  resolveLoad({ projects: [PROJECT] })
  await Promise.all([first, second, create])
  expect(store.projects.map(({ id }) => id)).toEqual(['p1', 'p2'])
  expect(request).toHaveBeenCalledTimes(2)
})

it('serializes project edits so a late full-row response cannot undo the next edit', async () => {
  store.projects = [{ ...PROJECT }]
  let finish
  const request = vi
    .spyOn(store, 'request')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce({ project: { ...PROJECT, name: 'Renamed', parentId: 'p2' } })
  const rename = store.renameProject('p1', 'Renamed')
  const move = store.moveProject('p1', 'p2')
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  finish({ project: { ...PROJECT, name: 'Renamed' } })
  await Promise.all([rename, move])
  expect(store.projects[0]).toMatchObject({ name: 'Renamed', parentId: 'p2' })
})
