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
      makeEmail('unread-1'),
      makeEmail('read-with-summary', { unread: false, hasAiSummary: true }),
      makeEmail('read-plain', { unread: false }),
    ]
    store.unreadInboxCount = 1
  })

  it('shows live inbox priorities and opens their existing reader', async () => {
    const openReader = vi.spyOn(store, 'openReader').mockImplementation(() => {})
    const wrapper = mount(AIInboxView)

    expect(wrapper.get('h1').text()).toBe('AI Inbox')
    expect(wrapper.get('[data-testid="ai-unread-count"]').text()).toBe('1 unread')
    expect(wrapper.get('[data-testid="ai-priority-list"]').text()).toContain('Subject unread-1')
    expect(wrapper.get('[data-testid="ai-summary-list"]').text()).toContain('Subject read-with-summary')
    expect(wrapper.get('[data-testid="ai-summary-list"]').text()).not.toContain('Subject read-plain')

    await wrapper.get('[data-testid="ai-priority-list"] .ai-inbox-open').trigger('click')

    expect(openReader).toHaveBeenCalledWith(store.traditionalEmails[0])
    expect(push).toHaveBeenCalledWith({ name: 'traditional-inbox' })
  })
})
