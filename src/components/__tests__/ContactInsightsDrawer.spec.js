import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ContactInsightsDrawer from '../ContactInsightsDrawer.vue'
import { useContactInsightsStore } from '../../stores/contactInsights'

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
})

function readyStore() {
  const store = useContactInsightsStore()
  store.isOpen = true
  store.contact = {
    address: 'alex@example.com',
    name: 'Alex Morgan',
    company: 'Example Studio',
    role: 'Director',
    linkedinUrl: 'https://linkedin.com/in/alex',
    notes: 'Prefers email',
  }
  store.history = [
    {
      id: 'message-1',
      subject: 'Project proposal',
      snippet: 'Thanks for sending this',
      sent_at: '2026-09-14T09:00:00.000Z',
      is_sent: false,
    },
  ]
  return store
}

describe('ContactInsightsDrawer', () => {
  it('renders profile details and opens a recent email', async () => {
    const store = readyStore()
    const openHistoryEmail = vi.spyOn(store, 'openHistoryEmail').mockImplementation(() => {})
    const wrapper = mount(ContactInsightsDrawer)

    expect(wrapper.text()).toContain('Alex Morgan')
    expect(wrapper.get('input[placeholder="Add company"]').element.value).toBe('Example Studio')
    expect(wrapper.text()).toContain('Project proposal')

    await wrapper.get('.contact-history-row').trigger('click')
    expect(openHistoryEmail).toHaveBeenCalledWith(store.history[0])
  })

  it('autosaves private notes after typing pauses', async () => {
    const store = readyStore()
    const saveContact = vi.spyOn(store, 'saveContact').mockResolvedValue(true)
    const wrapper = mount(ContactInsightsDrawer)

    await wrapper.get('textarea').setValue('Follow up next week')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()

    expect(saveContact).toHaveBeenCalledWith(
      'alex@example.com',
      expect.objectContaining({ notes: 'Follow up next week' }),
    )
  })
})
