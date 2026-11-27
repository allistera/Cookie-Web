import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import TasksRail from '../TasksRail.vue'
import { TASKS_API_URL } from '../../lib/apiWorkers'
import { SOMEDAY } from '../../lib/taskSomeday'
import { useInboxStore } from '../../stores/inbox'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useTaskLabelsStore } from '../../stores/taskLabels'

const TODAY = '2026-11-27'
const TODAY_URL = `${TASKS_API_URL}/task-items?project=today&date=${TODAY}&view=page`
const INBOX_URL = `${TASKS_API_URL}/task-items?project=inbox&view=page`

const TODAY_TASKS = [
  {
    id: 'timesheet',
    content: 'Check November timesheet approval',
    dueDate: '2026-11-26',
    projectId: 'work',
    priority: 1,
    labels: ['work'],
  },
  { id: 'reply', content: 'Reply to Mahenoor', dueDate: TODAY, dueTime: '13:00', projectId: null },
  { id: 'step', content: 'Find the form', parentId: 'timesheet', projectId: 'work' },
]
const INBOX_TASKS = [
  { id: 'reply', content: 'Reply to Mahenoor', dueDate: TODAY, dueTime: '13:00', projectId: null },
  { id: 'books', content: 'Return the library books', dueDate: SOMEDAY, projectId: null },
  { id: 'garage', content: 'Sort the garage shelving', dueDate: '2026-11-28', projectId: null },
]

let router
let wrapper
// What the tasks Worker holds; a write changes it the way the Worker would.
let todayTasks
let inboxTasks
let requests
let failWrites

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, { method = 'GET', body } = {}) => {
      requests.push({ url, method, body: body ? JSON.parse(body) : undefined })
      if (method === 'GET') {
        const items = url === TODAY_URL ? todayTasks : url === INBOX_URL ? inboxTasks : null
        if (!items) return { ok: false, status: 400, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => ({ items, nextCursor: null }) }
      }
      if (failWrites) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'The tasks service is down' }),
        }
      }
      const sent = JSON.parse(body)
      if (method === 'PATCH') {
        todayTasks = todayTasks.filter((row) => row.id !== sent.id)
        inboxTasks = inboxTasks.filter((row) => row.id !== sent.id)
        return { ok: true, status: 200, json: async () => ({ item: sent }) }
      }
      const item = { id: 'new', projectId: null, ...sent }
      if (item.dueDate === TODAY) todayTasks = [...todayTasks, item]
      inboxTasks = [...inboxTasks, item]
      return { ok: true, status: 200, json: async () => ({ item }) }
    }),
  )
}

async function render() {
  wrapper = mount(TasksRail, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const section = (name) => wrapper.get(`section[aria-label="${name}"]`)
const titles = (name) =>
  section(name)
    .findAll('.tr-content')
    .map((node) => node.text())
const writes = () => requests.filter((entry) => entry.method !== 'GET')

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inbox', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
    ],
  })
  await router.push('/inbox')
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 10, 27, 10, 30))
  setActivePinia(createPinia())
  localStorage.clear()
  todayTasks = TODAY_TASKS
  inboxTasks = INBOX_TASKS
  requests = []
  failWrites = false
  vi.spyOn(useTaskItemsStore(), 'authHeaders').mockResolvedValue({})
  // Seeded, so the rail does not ask the Worker for them.
  Object.assign(useProjectsStore(), {
    projects: [{ id: 'work', name: 'Work', parentId: null }],
    isLoaded: true,
  })
  Object.assign(useTaskLabelsStore(), {
    labels: [{ id: 'l1', name: 'work', color: '#246fe0' }],
    isLoaded: true,
  })
  mockApi()
})

afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TasksRail', () => {
  it('lists what is due today and the rest of the Inbox under the day', async () => {
    await render()

    expect(wrapper.get('.tr-title').text()).toBe('Tasks · Fri 27 Nov')
    expect(section('Today').get('.tr-section-title').text()).toBe('Today · 2')
    expect(titles('Today')).toEqual(['Check November timesheet approval', 'Reply to Mahenoor'])
    // A task due today is under Today only; sub-tasks are left to the Tasks view.
    expect(section('Inbox').get('.tr-section-title').text()).toBe('Inbox · 2')
    expect(titles('Inbox')).toEqual(['Return the library books', 'Sort the garage shelving'])
  })

  it('says when a task is due, where it lives and how it is labelled', async () => {
    await render()
    const [late, timed] = section('Today').findAll('.tr-task')

    expect(late.get('.tr-check').classes()).toContain('priority-1')
    expect(late.get('.tr-due').text()).toBe('Overdue · 26 Nov')
    expect(late.get('.tr-due').classes()).toContain('overdue')
    expect(late.get('.tr-home').text()).toBe('Work')
    expect(late.get('.tr-label').text()).toBe('@work')
    expect(timed.get('.tr-due').text()).toBe('13:00')
    expect(timed.get('.tr-home').text()).toBe('Inbox')

    const [someday, later] = section('Inbox').findAll('.tr-task')
    expect(someday.find('.tr-meta').exists()).toBe(false)
    expect(later.get('.tr-due').text()).toBe('28 Nov')
    expect(later.find('.tr-home').exists()).toBe(false)
  })

  it('opens a task in the Tasks view', async () => {
    await render()
    expect(section('Today').get('.tr-open').attributes('href')).toBe(
      '/tasks?project=today&task=timesheet',
    )
    expect(section('Inbox').get('.tr-open').attributes('href')).toBe(
      '/tasks?project=inbox&task=books',
    )
    expect(wrapper.get('.tr-open-tasks').attributes('href')).toBe('/tasks')
  })

  it('says so when there is nothing to do', async () => {
    todayTasks = []
    inboxTasks = []
    await render()

    expect(section('Today').get('.tr-section-title').text()).toBe('Today · 0')
    expect(section('Today').get('.tr-note').text()).toBe('Nothing due today.')
    expect(section('Inbox').get('.tr-note').text()).toBe('Your inbox is clear.')
  })

  it('completes a task and reads the lists back', async () => {
    await render()
    await section('Inbox').get('[aria-label="Complete Return the library books"]').trigger('click')
    await flushPromises()

    expect(writes()).toEqual([
      {
        url: `${TASKS_API_URL}/task-items`,
        method: 'PATCH',
        body: { id: 'books', completed: true },
      },
    ])
    expect(titles('Inbox')).toEqual(['Sort the garage shelving'])
    expect(section('Inbox').get('.tr-section-title').text()).toBe('Inbox · 1')
  })

  it('completes a repeating task for its day, so the Worker moves it on', async () => {
    todayTasks = [{ id: 'bins', content: 'Put the bins out', dueDate: TODAY, recurrence: 'weekly' }]
    await render()
    await section('Today').get('.tr-check').trigger('click')
    await flushPromises()

    expect(writes()[0].body).toEqual({
      id: 'bins',
      completed: true,
      today: TODAY,
      expectedDueDate: TODAY,
    })
  })

  it('puts the task back and says why when completing fails', async () => {
    const notify = vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    failWrites = true
    await render()
    await section('Inbox').get('.tr-check').trigger('click')
    await flushPromises()

    expect(titles('Inbox')).toEqual(['Return the library books', 'Sort the garage shelving'])
    expect(notify).toHaveBeenCalledWith('The tasks service is down', 'error')
  })

  it('adds a task due today under Today and an undated one under Inbox', async () => {
    await render()
    await section('Today').get('.tr-add').trigger('click')
    const input = section('Today').get('input')
    expect(document.activeElement).toBe(input.element)
    await input.setValue('  Ring the bank ')
    await input.trigger('keydown', { key: 'Enter' })
    // Enter also blurs the field; the draft is sent once.
    await input.trigger('blur')
    await flushPromises()

    expect(writes()).toEqual([
      {
        url: `${TASKS_API_URL}/task-items`,
        method: 'POST',
        body: { content: 'Ring the bank', projectId: null, dueDate: TODAY },
      },
    ])
    expect(titles('Today')).toContain('Ring the bank')
    expect(titles('Inbox')).not.toContain('Ring the bank')

    await section('Inbox').get('.tr-add').trigger('click')
    await section('Inbox').get('input').setValue('Buy stamps')
    await section('Inbox').get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(writes()[1].body).toEqual({ content: 'Buy stamps', projectId: null, dueDate: SOMEDAY })
    expect(titles('Inbox')).toContain('Buy stamps')
  })

  it('drops an empty or escaped draft', async () => {
    await render()
    await section('Inbox').get('.tr-add').trigger('click')
    await section('Inbox').get('input').setValue('Never mind')
    await section('Inbox').get('input').trigger('keydown', { key: 'Escape' })
    await section('Today').get('.tr-add').trigger('click')
    await section('Today').get('input').trigger('blur')
    await flushPromises()

    expect(writes()).toEqual([])
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('folds a section and remembers it in this browser', async () => {
    await render()
    const toggle = () => section('Today').get('.tr-section-toggle')
    expect(toggle().attributes('aria-expanded')).toBe('true')

    await toggle().trigger('click')
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(section('Today').find('.tr-list').exists()).toBe(false)
    expect(section('Today').find('.tr-add').exists()).toBe(false)
    expect(section('Inbox').find('.tr-list').exists()).toBe(true)

    wrapper.unmount()
    await render()
    expect(toggle().attributes('aria-expanded')).toBe('false')
  })

  it('reads the lists again when a task changes elsewhere on the page', async () => {
    await render()
    inboxTasks = [...inboxTasks, { id: 'stamps', content: 'Buy stamps', projectId: null }]
    await useTaskItemsStore().request('DELETE', { body: { id: 'gone' } })
    await flushPromises()

    expect(titles('Inbox')).toContain('Buy stamps')
  })

  it('follows the day across midnight', async () => {
    await render()
    vi.setSystemTime(new Date(2026, 10, 28, 0, 0, 5))
    todayTasks = []
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    expect(wrapper.get('.tr-title').text()).toBe('Tasks · Sat 28 Nov')
    expect(
      requests.some(({ url }) => url.includes('project=today&date=2026-11-28&view=page')),
    ).toBe(true)
  })

  it('says when the tasks could not be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    todayTasks = null
    await render()

    expect(section('Today').get('.tr-note').text()).toBe('Tasks could not be loaded.')
    expect(section('Today').get('.tr-section-title').text()).toBe('Today')
    expect(titles('Inbox')).toHaveLength(2)
  })

  it('closes from its header', async () => {
    await render()
    await wrapper.get('[aria-label="Hide tasks sidebar"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
