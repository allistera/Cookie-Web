import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AIInboxView from '../AIInboxView.vue'
import { useInboxStore } from '../../stores/inbox'

function mountView() {
  return mount(AIInboxView)
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

  it('greets Allister with the to-do and topic counters', () => {
    const wrapper = mountView()
    const greeting = wrapper.get('.ai-greeting').text()
    expect(greeting).toContain('Hi Allister')
    expect(greeting).toContain('5 to-dos')
    expect(greeting).toContain('4 topics')
  })

  it('shows three suggested to-dos with a "Show 2 more" toggle', () => {
    const wrapper = mountView()
    const rows = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')
    expect(rows).toHaveLength(3)

    const text = wrapper.text()
    expect(text).toContain('Kitchen Renovation')
    expect(text).toContain('RSVP for College Tour')
    expect(text).toContain('Bring snack to soccer practice')
    expect(wrapper.get('.show-more-btn').text()).toContain('Show 2 more')
  })

  it('reveals the hidden to-dos when "Show more" is clicked', async () => {
    const wrapper = mountView()
    await wrapper.get('.show-more-btn').trigger('click')

    const rows = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')
    expect(rows).toHaveLength(5)
    expect(wrapper.find('.show-more-btn').exists()).toBe(false)
  })

  it('completing a to-do removes it and decrements the counter', async () => {
    const wrapper = mountView()
    const firstRow = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')[0]
    await firstRow.get('.todo-check-btn').trigger('click')

    const rows = wrapper.get('[data-testid="todo-rows"]').findAll('.todo-row')
    expect(rows).toHaveLength(2)
    expect(wrapper.get('.ai-greeting').text()).toContain('4 to-dos')
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

  it('appends Todoist tasks and renders email tasks with a Draft action', () => {
    store.tasks = [
      {
        id: 'task-1',
        source: 'todoist',
        content: 'Renew car insurance',
        description: 'Policy expires Friday',
        url: 'https://app.todoist.com/app/task/task-1',
      },
      {
        id: 'task-2',
        source: 'todoist',
        content: 'Book dentist',
        description: null,
        url: null,
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
    ]

    const wrapper = mountView()
    const todoist = wrapper.get('[data-testid="todoist-rows"]')
    const rows = todoist.findAll('.todo-row')
    expect(rows).toHaveLength(2) // only the two todoist tasks

    // Title is bold, description sits beside it.
    expect(rows[0].get('strong').text()).toBe('Renew car insurance')
    expect(rows[0].text()).toContain('Renew car insurance – Policy expires Friday')
    expect(rows[0].text()).toContain('From: Todoist')

    // A task with a url gets an Open link; one without does not.
    const openLink = rows[0].get('a.action-pill-btn')
    expect(openLink.attributes('href')).toBe('https://app.todoist.com/app/task/task-1')
    expect(openLink.attributes('target')).toBe('_blank')
    expect(rows[1].find('a.action-pill-btn').exists()).toBe(false)

    const emailRows = wrapper.get('[data-testid="email-task-rows"]')
    expect(emailRows.text()).toContain('Reply to Apple – From an email')
    expect(emailRows.get('.action-pill-btn').text()).toContain('Draft')

    // The counter includes all gathered tasks (5 mock + 2 Todoist + 1 email).
    expect(wrapper.get('.ai-greeting').text()).toContain('8 to-dos')
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

    const rows = mountView().get('[data-testid="todoist-rows"]').findAll('.todo-row')

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
    await wrapper.get('[data-testid="email-task-rows"] .action-pill-btn').trigger('click')
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
    expect(wrapper.get('.ai-greeting').text()).toContain('6 to-dos')

    await wrapper.get('[data-testid="todoist-rows"] .todo-check-btn').trigger('click')
    await flushPromises()

    expect(completeTask).toHaveBeenCalledWith('task-1')
    expect(wrapper.find('[data-testid="todoist-rows"]').exists()).toBe(false)
    expect(wrapper.get('.ai-greeting').text()).toContain('5 to-dos')
  })

  it('rolls a Todoist task back into the list when completion fails', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: 'x', url: null },
    ]
    vi.spyOn(store, 'completeTask').mockRejectedValue(new Error('boom'))
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.get('[data-testid="todoist-rows"] .todo-check-btn').trigger('click')
    await flushPromises()

    // The row returns and the counter is restored.
    expect(wrapper.get('[data-testid="todoist-rows"]').findAll('.todo-row')).toHaveLength(1)
    expect(wrapper.get('.ai-greeting').text()).toContain('6 to-dos')
    expect(notify).toHaveBeenCalledWith('Failed to mark task done.', 'error')
  })
})
