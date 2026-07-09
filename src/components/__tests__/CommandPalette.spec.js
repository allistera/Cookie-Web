import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import CommandPalette from '../CommandPalette.vue'
import { useInboxStore } from '../../stores/inbox'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('../../auth0-client', () => ({
  getAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') }),
}))

function pressCmdK() {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
  )
}

describe('CommandPalette', () => {
  let store
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    store = useInboxStore()
    wrapper = mount(CommandPalette, { attachTo: document.body })
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('is hidden until Cmd+K opens it, with the first item selected', async () => {
    expect(wrapper.find('.cp-overlay').classes()).not.toContain('active')

    pressCmdK()
    await wrapper.vm.$nextTick()

    expect(store.isCommandPaletteOpen).toBe(true)
    expect(wrapper.find('.cp-overlay').classes()).toContain('active')
    const items = wrapper.findAll('.cp-item')
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].classes()).toContain('selected')
  })

  it('Cmd+K toggles the palette closed again', async () => {
    pressCmdK()
    await wrapper.vm.$nextTick()
    pressCmdK()
    await wrapper.vm.$nextTick()

    expect(store.isCommandPaletteOpen).toBe(false)
  })

  it('typing filters the command list', async () => {
    pressCmdK()
    await wrapper.vm.$nextTick()

    await wrapper.find('.cp-input').setValue('settings')

    const items = wrapper.findAll('.cp-item')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('Open Settings')
  })

  it('arrow keys move the selection and Enter runs the command', async () => {
    pressCmdK()
    await wrapper.vm.$nextTick()

    const input = wrapper.find('.cp-input')
    await input.setValue('go to')
    await input.trigger('keydown', { key: 'ArrowDown' })

    const items = wrapper.findAll('.cp-item')
    expect(items[1].classes()).toContain('selected')

    await input.trigger('keydown', { key: 'Enter' })
    expect(push).toHaveBeenCalledTimes(1)
    expect(store.isCommandPaletteOpen).toBe(false)
  })

  it('Enter on a coming-soon command shows a toast and closes', async () => {
    const email = { id: 'e1', unread: false, starred: false, labels: [] }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    pressCmdK()
    await wrapper.vm.$nextTick()

    const input = wrapper.find('.cp-input')
    await input.setValue('snooze')
    await input.trigger('keydown', { key: 'Enter' })

    expect(store.toasts.some((t) => t.message === 'Coming soon.')).toBe(true)
    expect(store.isCommandPaletteOpen).toBe(false)
    // The email itself is untouched.
    expect(store.traditionalEmails).toHaveLength(1)
  })

  it('Escape closes the palette without touching the open email', async () => {
    const email = { id: 'e1', unread: false, starred: false, labels: [] }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    pressCmdK()
    await wrapper.vm.$nextTick()

    await wrapper.find('.cp-input').trigger('keydown', { key: 'Escape' })

    expect(store.isCommandPaletteOpen).toBe(false)
    expect(store.openEmailId).toBe('e1')
  })

  it('shows email commands with keycap hints when an email is open', async () => {
    const email = { id: 'e1', unread: true, starred: false, labels: [] }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    pressCmdK()
    await wrapper.vm.$nextTick()

    const first = wrapper.findAll('.cp-item')[0]
    expect(first.text()).toContain('Mark Done')
    expect(first.find('.cp-keycap').text()).toBe('E')
  })
})
