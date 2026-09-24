import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import SenderControls from '../SenderControls.vue'
import SenderSettings from '../SenderSettings.vue'
import { useSendersStore } from '../../stores/senders'

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useSendersStore()
  store.setOwner('account-a')
  vi.spyOn(store, 'lookup').mockResolvedValue(true)
  vi.spyOn(store, 'load').mockResolvedValue(true)
})
afterEach(() => vi.restoreAllMocks())
const mountControls = () =>
  mount(SenderControls, {
    props: { email: { id: 'message', address: ' Sender@Example.com ', screeningStatus: 'held' } },
    global: { stubs: { RouterLink: true } },
    attachTo: document.body,
  })

describe('reader sender controls', () => {
  it('accepts the exact displayed sender and offers explicit one-message restoration', async () => {
    const store = useSendersStore()
    const update = vi.spyOn(store, 'update').mockResolvedValue(true)
    const wrapper = mountControls()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Accept sender')
      .trigger('click')
    expect(update).toHaveBeenLastCalledWith({
      action: 'accept',
      address: 'sender@example.com',
      messageId: 'message',
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Restore this message only')
      .trigger('click')
    expect(update).toHaveBeenLastCalledWith({
      action: 'restore',
      address: 'sender@example.com',
      messageId: 'message',
    })
    expect(wrapper.emitted('changed')).toHaveLength(2)
    wrapper.unmount()
  })
  it('owns Escape and archive shortcuts even when a button has focus', async () => {
    const listener = vi.fn()
    document.addEventListener('keydown', listener)
    const wrapper = mountControls()
    await flushPromises()
    await wrapper.get('button').trigger('keydown', { key: 'e' })
    await wrapper.get('button').trigger('keydown', { key: 'Escape' })
    expect(listener).not.toHaveBeenCalled()
    document.removeEventListener('keydown', listener)
    wrapper.unmount()
  })
  it('explains explicit trust and defaults screening off in Settings', async () => {
    const store = useSendersStore()
    store.loaded = true
    const update = vi.spyOn(store, 'update').mockResolvedValue(false)
    const wrapper = mount(SenderSettings, { global: { stubs: { RouterLink: true } } })
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(false)
    expect(wrapper.text()).toContain(
      'Past incoming mail, contacts and sent mail do not automatically grant trust',
    )
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(update).toHaveBeenCalledWith({ action: 'settings', enabled: true })
    expect(store.enabled).toBe(false)
    wrapper.unmount()
  })
})
