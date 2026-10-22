import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ComposerWindow from '../ComposerWindow.vue'
import ScheduleMenu from '../ScheduleMenu.vue'
import { useInboxStore } from '../../stores/inbox'

let wrapper
let store
beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
  store.isComposerActive = true
  store.composerTo = 'alice@example.com'
  store.composerTextArea = 'Hello'
  vi.spyOn(store, 'scheduleComposerDraftSave').mockImplementation(() => {})
  vi.spyOn(store, 'flushComposerDraft').mockResolvedValue(true)
  wrapper = shallowMount(ComposerWindow, { attachTo: document.body })
})
afterEach(() => {
  wrapper.unmount()
  vi.restoreAllMocks()
})

describe('composer interactions', () => {
  it('selects a contact with arrow keys and Enter', async () => {
    store.contacts = [
      { name: 'Bob', address: 'bob@example.com' },
      { name: 'Alice', address: 'alice@example.com' },
    ]
    const input = wrapper.get('.composer-to-inline')
    await input.setValue('alice@example.com, bo')
    await input.trigger('focus')
    expect(wrapper.findAll('.composer-suggest-address').map((node) => node.text())).toEqual([
      'bob@example.com',
    ])
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(store.composerTo).toContain('bob@example.com')
    expect(store.composerTo).toContain('alice@example.com')
    expect(wrapper.find('.composer-suggestions').exists()).toBe(false)
  })

  it('closes suggestions before the AI panel or composer on Escape', async () => {
    store.contacts = [{ name: 'Bob', address: 'bob@example.com' }]
    const close = vi.spyOn(store, 'closeComposer').mockImplementation(() => {})
    const input = wrapper.get('.composer-to-inline')
    await input.setValue('bo')
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.composer-suggestions').exists()).toBe(false)
    expect(close).not.toHaveBeenCalled()
    store.isAiDraftActive = true
    await nextTick()
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(store.isAiDraftActive).toBe(false)
    expect(close).not.toHaveBeenCalled()
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('selects and clears a follow-up reminder', async () => {
    await wrapper.get('.composer-follow-up-btn').trigger('click')
    const date = new Date('2030-01-02T12:00:00Z')
    wrapper.findComponent(ScheduleMenu).vm.$emit('select', { date, label: 'Tomorrow' })
    await nextTick()
    expect(store.composerFollowUpAt).toBe(date.toISOString())
    await wrapper.get('.composer-follow-up-btn').trigger('click')
    wrapper.findComponent(ScheduleMenu).vm.$emit('clear')
    await nextTick()
    expect(store.composerFollowUpAt).toBeNull()
  })

  it.each([false, true])('checks the reminder before scheduling a send (%s)', async (tooEarly) => {
    const date = new Date('2030-01-02T12:00:00Z')
    store.composerFollowUpAt = new Date(date.getTime() + (tooEarly ? 30000 : 120000)).toISOString()
    const send = vi.spyOn(store, 'sendEmailLater').mockResolvedValue(true)
    const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
    await wrapper.get('.composer-schedule-caret').trigger('click')
    wrapper.findComponent(ScheduleMenu).vm.$emit('select', { date, label: 'Tomorrow' })
    await nextTick()
    expect(send.mock.calls).toEqual(tooEarly ? [] : [[date.toISOString(), 'Tomorrow']])
    expect(notify).toHaveBeenCalledTimes(tooEarly ? 1 : 0)
  })

  it('closes scheduling menus on an outside click', async () => {
    await wrapper.get('.composer-follow-up-btn').trigger('click')
    expect(wrapper.findComponent(ScheduleMenu).exists()).toBe(true)
    document.body.click()
    await nextTick()
    expect(wrapper.findComponent(ScheduleMenu).exists()).toBe(false)
  })

  it('flushes an active draft when the page becomes hidden', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(store.flushComposerDraft).toHaveBeenCalledOnce()
    store.isComposerActive = false
    await nextTick()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(store.flushComposerDraft).toHaveBeenCalledOnce()
  })
})
