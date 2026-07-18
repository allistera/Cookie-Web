import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AIInboxView from '../AIInboxView.vue'
import { useInboxStore } from '../../stores/inbox'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

function makeEmail(id, { unread = true, hasAiSummary = false } = {}) {
  return {
    id,
    sender: `Sender ${id}`,
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    unread,
    hasAiSummary,
  }
}

describe('AIInboxView', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockReset()
    store = useInboxStore()
    store.traditionalEmails = [
      makeEmail('read-with-summary', { unread: false, hasAiSummary: true }),
      makeEmail('read-plain', { unread: false }),
    ]
    store.unreadInboxCount = 1
    // Pre-load tasks so onMounted's loadTasks() short-circuits (cached).
    store.tasks = [
      {
        id: 't1',
        source: 'todoist',
        content: 'Ship the release',
        description: 'v2',
        due_date: '2026-07-18',
        priority: 4,
        url: 'https://app.todoist.com/app/task/abc',
        message_id: null,
      },
      {
        id: 't2',
        source: 'email',
        content: 'Reply to Apple',
        description: null,
        due_date: null,
        priority: null,
        url: null,
        message_id: 'm1',
      },
    ]
    store.tasksLoaded = true
  })

  it('shows gathered tasks in Needs attention, with an Open link only for linked tasks', () => {
    const wrapper = mount(AIInboxView)

    const list = wrapper.get('[data-testid="ai-priority-list"]')
    expect(list.text()).toContain('Ship the release')
    expect(list.text()).toContain('Urgent') // priority 4
    expect(list.text()).toContain('Reply to Apple')

    const links = list.findAll('a.ai-inbox-open')
    expect(links).toHaveLength(1) // only the todoist task has a url
    expect(links[0].attributes('href')).toBe('https://app.todoist.com/app/task/abc')
    expect(links[0].attributes('target')).toBe('_blank')
  })

  it('still lists AI-summarized emails in Ready to catch up', () => {
    const wrapper = mount(AIInboxView)

    const summary = wrapper.get('[data-testid="ai-summary-list"]')
    expect(summary.text()).toContain('Subject read-with-summary')
    expect(summary.text()).not.toContain('Subject read-plain')
    expect(wrapper.get('[data-testid="ai-unread-count"]').text()).toBe('1 unread')
  })
})
