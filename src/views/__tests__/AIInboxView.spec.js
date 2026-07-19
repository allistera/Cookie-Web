import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
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

  it('appends Todoist tasks (title bold, description beside) and excludes email tasks', () => {
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

    // Email-sourced tasks are not shown here.
    expect(todoist.text()).not.toContain('Reply to Apple')

    // The counter includes the appended Todoist tasks (5 mock + 2 todoist).
    expect(wrapper.get('.ai-greeting').text()).toContain('7 to-dos')
  })

  it('dismissing a Todoist task hides it and updates the counter', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: 'x', url: null },
    ]

    const wrapper = mountView()
    expect(wrapper.get('.ai-greeting').text()).toContain('6 to-dos')

    await wrapper.get('[data-testid="todoist-rows"] .todo-check-btn').trigger('click')

    expect(wrapper.find('[data-testid="todoist-rows"]').exists()).toBe(false)
    expect(wrapper.get('.ai-greeting').text()).toContain('5 to-dos')
  })
})
