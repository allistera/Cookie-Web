import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AIInboxView from '../AIInboxView.vue'
import { useInboxStore } from '../../stores/inbox'

vi.mock('@auth0/auth0-vue', () => ({
  useAuth0: () => ({ user: { value: { name: 'Allister Antosik' } } }),
}))

function mountView() {
  return mount(AIInboxView)
}

function rowsOf(wrapper) {
  return wrapper.get('[data-testid="task-rows"]').findAll('.todo-row')
}

describe('AIInboxView (AI Today)', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    // Short-circuit onMounted's loadTasks() so it never hits the network.
    store.tasksLoaded = true
    store.tasks = []
  })

  it('greets the signed-in user by first name with the counters', () => {
    store.tasks = [{ id: 'task-1', source: 'todoist', content: 'Book dentist', url: null }]

    const greeting = mountView().get('.ai-greeting').text()
    expect(greeting).toContain('Hi Allister')
    expect(greeting).not.toContain('Antosik')
    expect(greeting).toContain('1 to-dos')
    expect(greeting).toContain('4 topics')
  })

  it('shows an empty state and a zero count when nothing was gathered', () => {
    const wrapper = mountView()
    expect(rowsOf(wrapper)).toHaveLength(0)
    expect(wrapper.get('[data-testid="tasks-empty"]').text()).toContain('Nothing gathered for today')
    expect(wrapper.get('.ai-greeting').text()).toContain('0 to-dos')
  })

  it('renders the four catch-up topics', () => {
    const wrapper = mountView()
    const titles = wrapper.findAll('.topic-title').map((t) => t.text())
    expect(titles).toHaveLength(4)
    expect(titles[0]).toContain('Kitchen Renovation')
    expect(titles[1]).toContain('College Search')
    expect(titles[2]).toContain('Soccer Spring Season')
    expect(titles[3]).toContain('More Updates')
  })

  it('renders gathered tasks in API order with source-appropriate actions', () => {
    store.tasks = [
      {
        id: 'task-1',
        source: 'todoist',
        content: 'Renew car insurance',
        description: 'Policy expires Friday',
        url: 'https://app.todoist.com/app/task/task-1',
      },
      {
        id: 'task-3',
        source: 'email',
        content: 'Reply to Apple',
        description: 'From an email',
        message_id: 'message-1',
        reply_to: 'apple@example.com',
        message_subject: 'Your support request',
        url: null,
      },
      {
        id: 'task-2',
        source: 'todoist',
        content: 'Book dentist',
        description: null,
        url: null,
      },
    ]

    const wrapper = mountView()
    const rows = rowsOf(wrapper)
    // One list, kept in the order the API returned (most pressing first).
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.get('strong').text())).toEqual([
      'Renew car insurance',
      'Reply to Apple',
      'Book dentist',
    ])

    // Title is bold, description sits beside it.
    expect(rows[0].text()).toContain('Renew car insurance – Policy expires Friday')
    expect(rows[0].text()).toContain('From: Todoist')
    expect(rows[1].text()).toContain('From: Email')

    // A Todoist task with a url gets an Open link; one without gets no action.
    const openLink = rows[0].get('a.action-pill-btn')
    expect(openLink.attributes('href')).toBe('https://app.todoist.com/app/task/task-1')
    expect(openLink.attributes('target')).toBe('_blank')
    expect(rows[2].find('.action-pill-btn').exists()).toBe(false)

    // An email-sourced task offers a follow-up draft instead.
    expect(rows[1].get('.action-pill-btn').text()).toContain('Draft')

    expect(wrapper.get('.ai-greeting').text()).toContain('3 to-dos')
  })

  // Task URLs reach the app from Todoist via /api/tasks, so they are external
  // input rendered straight into an href.
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['a relative path', '/app/task/task-1'],
  ])('does not render %s as an Open link', (_label, url) => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: null, url },
    ]

    const rows = rowsOf(mountView())

    expect(rows).toHaveLength(1)
    expect(rows[0].find('a.action-pill-btn').exists()).toBe(false)
  })

  it('generates a follow-up draft from an email task', async () => {
    const task = {
      id: 'task-email',
      source: 'email',
      content: 'Follow up with the contractor',
      description: 'Confirm the Tuesday delivery',
      message_id: 'message-1',
      reply_to: 'contractor@example.com',
      message_subject: 'Delivery date',
    }
    store.tasks = [task]
    const draftFollowUp = vi.spyOn(store, 'draftFollowUp').mockResolvedValue(true)
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.get('[data-testid="task-rows"] .action-pill-btn').trigger('click')
    await flushPromises()

    expect(draftFollowUp).toHaveBeenCalledWith(task)
    expect(notify).toHaveBeenCalledWith('Follow-up draft ready to review.')
  })

  it('completing a Todoist task persists it, hides it, and updates the counter', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: 'x', url: null },
    ]
    const completeTask = vi.spyOn(store, 'completeTask').mockResolvedValue({ ok: true })

    const wrapper = mountView()
    expect(wrapper.get('.ai-greeting').text()).toContain('1 to-dos')

    await wrapper.get('[data-testid="task-rows"] .todo-check-btn').trigger('click')
    await flushPromises()

    expect(completeTask).toHaveBeenCalledWith('task-1')
    expect(rowsOf(wrapper)).toHaveLength(0)
    expect(wrapper.get('.ai-greeting').text()).toContain('0 to-dos')
  })

  it('rolls a Todoist task back into the list when completion fails', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: 'x', url: null },
    ]
    vi.spyOn(store, 'completeTask').mockRejectedValue(new Error('boom'))
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.get('[data-testid="task-rows"] .todo-check-btn').trigger('click')
    await flushPromises()

    // The row returns and the counter is restored.
    expect(rowsOf(wrapper)).toHaveLength(1)
    expect(wrapper.get('.ai-greeting').text()).toContain('1 to-dos')
    expect(notify).toHaveBeenCalledWith('Failed to mark task done.', 'error')
  })

  it('reports how stale the gathered set is and re-reads past the cache', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    store.tasks = [
      {
        id: 'task-1',
        source: 'todoist',
        content: 'Renew car insurance',
        url: null,
        gathered_at: twoHoursAgo,
      },
    ]
    const loadTasks = vi.spyOn(store, 'loadTasks').mockResolvedValue()

    const wrapper = mountView()
    expect(wrapper.get('.status-time').text()).toBe('Updated 2h ago')

    await wrapper.get('.ai-update-status').trigger('click')
    await flushPromises()

    expect(loadTasks).toHaveBeenCalledWith({ force: true })
  })

  it('falls back when no task carries a gathered_at', () => {
    store.tasks = [{ id: 'task-1', source: 'todoist', content: 'Book dentist', url: null }]
    expect(mountView().get('.status-time').text()).toBe('Not gathered yet')
  })
})
