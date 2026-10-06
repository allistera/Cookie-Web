import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import SenderSettings from '../SenderSettings.vue'
import { useSendersStore } from '../../stores/senders'
import { useInboxStore } from '../../stores/inbox'

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useSendersStore()
  store.setOwner('account-a')
  vi.spyOn(store, 'load').mockResolvedValue(true)
  vi.spyOn(useInboxStore(), 'refreshSenderMail').mockResolvedValue()
})
afterEach(() => vi.restoreAllMocks())
describe('sender settings', () => {
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
  it('lists domain decisions by domain and lets Settings add a blocked domain', async () => {
    const store = useSendersStore()
    store.loaded = true
    store.decisions = [
      { address: '@shop.example', decision: 'accepted' },
      { address: 'friend@gmail.com', decision: 'blocked' },
    ]
    const update = vi.spyOn(store, 'update').mockResolvedValue(true)
    const wrapper = mount(SenderSettings, { global: { stubs: { RouterLink: true } } })
    const rows = wrapper.findAll('li').map((row) => row.get('span').text())
    expect(rows).toEqual([
      'shop.example and its subdomains — accepted',
      'friend@gmail.com — blocked',
    ])
    await wrapper.get('input[type="text"]').setValue('badco.example')
    await wrapper.get('select').setValue('block')
    await wrapper.get('form').trigger('submit')
    expect(update).toHaveBeenCalledWith({ action: 'block', address: 'badco.example' })
    wrapper.unmount()
  })
  it('manages existing decisions and pagination from Settings', async () => {
    const store = useSendersStore()
    const inbox = useInboxStore()
    store.loaded = true
    store.error = 'Could not load senders.'
    store.nextCursor = 'next-page'
    store.decisions = [
      { address: '@shop.example', decision: 'accepted' },
      { address: 'blocked@example.com', decision: 'blocked' },
    ]
    const update = vi.spyOn(store, 'update').mockResolvedValue(true)
    const refreshSenderMail = vi.spyOn(inbox, 'refreshSenderMail').mockResolvedValue()
    const wrapper = mount(SenderSettings, { global: { stubs: { RouterLink: true } } })

    expect(wrapper.get('[role=alert]').text()).toBe('Could not load senders.')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove acceptance')
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Block')
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Unblock')
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Accept and release')
      .trigger('click')
    await flushPromises()

    expect(update.mock.calls.map(([body]) => body)).toEqual([
      { action: 'forget', address: '@shop.example' },
      { action: 'block', address: '@shop.example' },
      { action: 'unblock', address: 'blocked@example.com' },
      { action: 'accept', address: 'blocked@example.com' },
    ])
    expect(refreshSenderMail).toHaveBeenCalledTimes(4)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Reload senders')
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Load more senders')
      .trigger('click')
    expect(store.load).toHaveBeenLastCalledWith({ more: true })
    wrapper.unmount()
  })
})
