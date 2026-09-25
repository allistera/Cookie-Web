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

  it('saves a pending draft to its own contact after switching to another', async () => {
    const store = readyStore()
    const saveContact = vi.spyOn(store, 'saveContact').mockResolvedValue(true)
    const wrapper = mount(ContactInsightsDrawer)

    await wrapper.get('textarea').setValue('Alex only')
    // Mirrors openContact(): the store switches contact and resets the indicator.
    store.contact = { address: 'blair@example.com', name: 'Blair', notes: 'Blair notes' }
    store.saveState = 'idle'
    await flushPromises()
    wrapper.unmount()
    await flushPromises()

    expect(saveContact).toHaveBeenCalledTimes(1)
    expect(saveContact).toHaveBeenCalledWith(
      'alex@example.com',
      expect.objectContaining({ notes: 'Alex only', company: 'Example Studio' }),
    )
    // The next contact's save indicator is left alone.
    expect(store.saveState).toBe('idle')
  })

  it('never loads the next contact into an untouched draft', async () => {
    const store = readyStore()
    const saveContact = vi.spyOn(store, 'saveContact').mockResolvedValue(true)
    const wrapper = mount(ContactInsightsDrawer)

    store.contact = { address: 'blair@example.com', company: 'Blair Co' }
    await flushPromises()

    expect(wrapper.get('input[placeholder="Add company"]').element.value).toBe('Example Studio')
    wrapper.unmount()
    await flushPromises()
    expect(saveContact).not.toHaveBeenCalled()
  })

  it('keeps the drawer open when the final save on close fails', async () => {
    const store = readyStore()
    const saveContact = vi.spyOn(store, 'saveContact').mockResolvedValue(false)
    const closeStore = vi.spyOn(store, 'close')
    const wrapper = mount(ContactInsightsDrawer)

    await wrapper.get('textarea').setValue('Unsaved thought')
    await wrapper.get('button[aria-label="Close contact insights"]').trigger('click')
    await flushPromises()

    expect(saveContact).toHaveBeenCalledTimes(1)
    expect(closeStore).not.toHaveBeenCalled()
    expect(wrapper.get('textarea').element.value).toBe('Unsaved thought')

    // Closing again retries the same draft and closes once it saves.
    saveContact.mockResolvedValue(true)
    await wrapper.get('button[aria-label="Close contact insights"]').trigger('click')
    await flushPromises()

    expect(saveContact).toHaveBeenCalledTimes(2)
    expect(saveContact).toHaveBeenLastCalledWith(
      'alex@example.com',
      expect.objectContaining({ notes: 'Unsaved thought' }),
    )
    expect(closeStore).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight save before closing', async () => {
    const store = readyStore()
    let finishSave
    const saveContact = vi
      .spyOn(store, 'saveContact')
      .mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)))
      .mockResolvedValue(false)
    const closeStore = vi.spyOn(store, 'close')
    const wrapper = mount(ContactInsightsDrawer)

    await wrapper.get('textarea').setValue('Blurred note')
    await wrapper.get('textarea').trigger('blur')
    await wrapper.get('button[aria-label="Close contact insights"]').trigger('click')
    await flushPromises()
    expect(closeStore).not.toHaveBeenCalled()

    finishSave(false)
    await flushPromises()

    // The failed blur save is retried on close; that retry fails too.
    expect(saveContact).toHaveBeenCalledTimes(2)
    expect(closeStore).not.toHaveBeenCalled()
  })

  it('does not let a repeated close skip a pending retry', async () => {
    const store = readyStore()
    const pending = []
    const saveContact = vi
      .spyOn(store, 'saveContact')
      .mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const closeStore = vi.spyOn(store, 'close')
    const wrapper = mount(ContactInsightsDrawer)
    const closeButton = wrapper.get('button[aria-label="Close contact insights"]')

    await wrapper.get('textarea').setValue('Double-clicked note')
    await wrapper.get('textarea').trigger('blur')
    await closeButton.trigger('click')
    await closeButton.trigger('click')

    // The blur save fails, so close retries it once; the second click must
    // not close the drawer while that retry is still in flight.
    pending[0](false)
    await flushPromises()
    expect(saveContact).toHaveBeenCalledTimes(2)
    expect(closeStore).not.toHaveBeenCalled()

    pending[1](false)
    await flushPromises()
    expect(closeStore).not.toHaveBeenCalled()
    expect(wrapper.get('textarea').element.value).toBe('Double-clicked note')
  })

  it('closes immediately when there is nothing to save', async () => {
    const store = readyStore()
    const saveContact = vi.spyOn(store, 'saveContact')
    const closeStore = vi.spyOn(store, 'close')
    const wrapper = mount(ContactInsightsDrawer)

    await wrapper.get('button[aria-label="Close contact insights"]').trigger('click')
    await flushPromises()

    expect(saveContact).not.toHaveBeenCalled()
    expect(closeStore).toHaveBeenCalledTimes(1)
  })
})
