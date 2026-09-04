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
    // The in-view composer only exists while that project is on screen.
    store.loadedProject = 'p1'
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

  // A sub-task sends only its parent — the server derives the project from
  // the parent row — and it belongs wherever its parent is already listed.
  it('creates a sub-task against its parent and lists it beside it', async () => {
    store.loadedProject = 'p1'
    store.items = [{ ...ITEM }]
    const SUB = {
      id: 't2',
      projectId: 'p1',
      parentId: 't1',
      content: 'Step one',
      completedAt: null,
    }
    stubFetch(async () => ({ ok: true, json: async () => ({ item: SUB }) }))

    await store.createItem({ content: 'Step one', parentId: 't1' })

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ content: 'Step one', parentId: 't1' })
    expect(store.items).toHaveLength(2)
  })

  it('leaves the list alone for a sub-task whose parent is not on screen', async () => {
    store.loadedProject = 'today'
    store.items = []
    const SUB = {
      id: 't2',
      projectId: 'p1',
      parentId: 't1',
      content: 'Step one',
      completedAt: null,
    }
    stubFetch(async () => ({ ok: true, json: async () => ({ item: SUB }) }))

    await store.createItem({ content: 'Step one', parentId: 't1' })

    expect(store.items).toEqual([])
  })

  // A completed sub-task stays listed: the panel shows it checked and counts
  // it into its "done/total" progress.
  it('keeps a completed sub-task in the list, marked complete', async () => {
    const SUB = {
      id: 't2',
      projectId: 'p1',
      parentId: 't1',
      content: 'Step one',
      completedAt: null,
    }
    store.items = [{ ...ITEM }, { ...SUB }]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...SUB, completedAt: '2026-08-29T10:00:00Z' } }),
    }))

    await store.setCompleted('t2', true)

    expect(store.items).toHaveLength(2)
    expect(store.items[1].completedAt).toBe('2026-08-29T10:00:00Z')
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

describe('priority', () => {
  it('sends a priority and applies it locally', async () => {
    store.items = [{ ...ITEM, priority: 4 }]
    stubFetch(async () => ({ ok: true, json: async () => ({ item: { ...ITEM, priority: 1 } }) }))

    await store.setPriority('t1', 1)

    const [, options] = fetch.mock.calls[0]
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ id: 't1', priority: 1 })
    expect(store.items[0].priority).toBe(1)
  })

  // The server refuses a bad priority rather than clamping it, so the
  // optimistic local value has to go back to what it was.
  it('rolls the priority back and surfaces the server message when refused', async () => {
    store.items = [{ ...ITEM, priority: 2 }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'priority must be an integer from 1 to 4' }),
    }))

    await store.setPriority('t1', 9)

    expect(store.items[0].priority).toBe(2)
    expect(notify).toHaveBeenCalledWith('priority must be an integer from 1 to 4', 'error')
  })
})

describe('moving a task between projects', () => {
  it('sends the new project and applies it locally', async () => {
    store.items = [{ ...ITEM }]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, projectId: 'p2' } }),
    }))

    await store.moveItem('t1', 'p2')

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ id: 't1', projectId: 'p2' })
    expect(store.items[0].projectId).toBe('p2')
  })

  // The Inbox is "belongs to no project", so moving there sends null.
  it('sends null when moving a task to the Inbox', async () => {
    store.items = [{ ...ITEM }]
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, projectId: null } }),
    }))

    await store.moveItem('t1', null)

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ id: 't1', projectId: null })
    expect(store.items[0].projectId).toBeNull()
  })

  // The list on screen is one project's; a task moved to another no longer
  // belongs on it. Today spans every project, so there a move changes only
  // the row's home.
  it('drops the task from the project list it was moved out of', async () => {
    store.items = [{ ...ITEM }]
    store.loadedProject = 'p1'
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, projectId: 'p2' } }),
    }))

    await store.moveItem('t1', 'p2')

    expect(store.items).toEqual([])
  })

  it('keeps a moved task on the Today list', async () => {
    const today = new Date().toISOString().slice(0, 10)
    store.items = [{ ...ITEM, dueDate: today }]
    store.loadedProject = 'today'
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, dueDate: today, projectId: 'p2' } }),
    }))

    await store.moveItem('t1', 'p2')

    expect(store.items).toHaveLength(1)
    expect(store.items[0].projectId).toBe('p2')
  })

  it('rolls back and surfaces the server message when the move is refused', async () => {
    store.items = [{ ...ITEM }]
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Project not found' }),
    }))

    await store.moveItem('t1', 'gone')

    expect(store.items[0].projectId).toBe('p1')
    expect(notify).toHaveBeenCalledWith('Project not found', 'error')
  })
})

describe('re-arranging tasks', () => {
  const rows = () => [
    { id: 'a', content: 'A', position: 1, completedAt: null },
    { id: 'b', content: 'B', position: 2, completedAt: null },
    { id: 'c', content: 'C', position: 3, completedAt: null },
  ]

  it('re-sorts the list at once and sends the whole order', async () => {
    store.items = rows()
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [] }) }))

    const pending = store.reorderItems(['c', 'a', 'b'])
    expect(store.items.map((row) => row.id)).toEqual(['c', 'a', 'b'])
    await expect(pending).resolves.toBe(true)

    const [requestUrl, options] = fetch.mock.calls[0]
    expect(requestUrl).toContain('/task-items/reorder')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ ids: ['c', 'a', 'b'] })
    expect(store.items.map((row) => row.position)).toEqual([1, 2, 3])
  })

  it('puts the order back and surfaces the server message when refused', async () => {
    store.items = rows()
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    stubFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'ids must not repeat' }),
    }))

    await expect(store.reorderItems(['c', 'a', 'b'])).resolves.toBe(false)

    expect(store.items.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(store.items.map((row) => row.position)).toEqual([1, 2, 3])
    expect(notify).toHaveBeenCalledWith('ids must not repeat', 'error')
  })

  // Two quick drags: the second order must reach the server after the
  // first, and an older failure must not undo the newer order.
  it('sends orders one at a time and lets the newest win', async () => {
    store.items = rows()
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    let failFirst
    const first = new Promise((resolve) => {
      failFirst = resolve
    })
    stubFetch(
      vi
        .fn()
        .mockImplementationOnce(() => first)
        .mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }),
    )

    const firstDrag = store.reorderItems(['c', 'a', 'b'])
    const secondDrag = store.reorderItems(['b', 'c', 'a'])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenCalledTimes(1)

    failFirst({ ok: false, status: 500, json: async () => ({}) })
    await expect(firstDrag).resolves.toBe(false)
    await expect(secondDrag).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ids: ['b', 'c', 'a'] })
    expect(store.items.map((row) => row.id)).toEqual(['b', 'c', 'a'])
    expect(notify).not.toHaveBeenCalled()
  })

  // Today mixes projects, so its rows keep the position values they had
  // between them (dealt out in the new order) and the list stays in
  // due-date order around them.
  it('deals the rows’ own positions out in Today, keeping due-date order', async () => {
    store.items = [
      { id: 'late', content: 'L', dueDate: '2026-09-01', position: 40, completedAt: null },
      { id: 'a', content: 'A', dueDate: '2026-09-03', position: 10, completedAt: null },
      { id: 'b', content: 'B', dueDate: '2026-09-03', position: 30, completedAt: null },
    ]
    store.loadedProject = 'today'
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [] }) }))

    await store.reorderItems(['b', 'a'])

    expect(store.items.map((row) => row.id)).toEqual(['late', 'b', 'a'])
    expect(store.items.map((row) => row.position)).toEqual([40, 10, 30])
  })

  it('does nothing with an empty order', async () => {
    store.items = rows()
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [] }) }))

    expect(await store.reorderItems([])).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('the Today list', () => {
  // Today carries overdue tasks forward, so a task due yesterday belongs on
  // it as much as one due today.
  it('counts an overdue task as belonging to the Today list', () => {
    store.loadedProject = 'today'
    expect(store.belongsToLoadedList({ ...ITEM, dueDate: '2000-01-01' })).toBe(true)
    expect(store.belongsToLoadedList({ ...ITEM, dueDate: '2999-01-01' })).toBe(false)
    expect(store.belongsToLoadedList({ ...ITEM, dueDate: null })).toBe(false)
  })

  it("sends the browser's local date, not a UTC one", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [] }) }))
    // 23:30 on the 29th in a zone behind UTC is already the 30th in UTC. The
    // request must carry the date the person is actually living in.
    vi.setSystemTime(new Date('2026-08-30T02:30:00Z'))
    const localDate = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    await store.loadItems('today')

    const [requestUrl] = fetch.mock.calls[0]
    expect(requestUrl).toContain('project=today')
    expect(requestUrl).toContain(`date=${localDate}`)
    vi.useRealTimers()
  })

  it('does not send a date for an ordinary project', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ items: [] }) }))

    await store.loadItems('p1')

    expect(fetch.mock.calls[0][0]).not.toContain('date=')
  })
})

describe('creating a task that belongs elsewhere', () => {
  it('adds the new task to the list when it belongs there', async () => {
    store.loadedProject = 'p1'
    stubFetch(async () => ({ ok: true, json: async () => ({ item: { ...ITEM } }) }))

    await store.createItem({ content: 'Ship it', projectId: 'p1' })

    expect(store.items).toHaveLength(1)
  })

  // Add Task creates in the Inbox from anywhere, so a task made while a
  // project is on screen must not appear under that project's heading.
  it('leaves the list alone when the new task belongs to another project', async () => {
    store.loadedProject = 'p1'
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, id: 't2', projectId: null } }),
    }))

    const created = await store.createItem({ content: 'Inbox thing', projectId: null })

    expect(created).toMatchObject({ id: 't2' })
    expect(store.items).toEqual([])
  })

  it('adds an Inbox task while the Inbox is on screen', async () => {
    store.loadedProject = 'inbox'
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, projectId: null } }),
    }))

    await store.createItem({ content: 'Inbox thing', projectId: null })

    expect(store.items).toHaveLength(1)
  })

  // Today is a date filter, and a task created without one is not due today.
  it('leaves Today alone when the new task has no date', async () => {
    store.loadedProject = 'today'
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ item: { ...ITEM, projectId: null, dueDate: null } }),
    }))

    await store.createItem({ content: 'Someday', projectId: null })

    expect(store.items).toEqual([])
  })
})
