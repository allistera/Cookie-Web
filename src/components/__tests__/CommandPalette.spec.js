import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import CommandPalette from '../CommandPalette.vue'
import { useInboxStore } from '../../stores/inbox'
import { setAuth0Client } from '../../auth0-client'

function pressSlash(target = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
}

describe('CommandPalette', () => {
  let store
  let wrapper
  let push

  function openPalette() {
    store.isCommandPaletteOpen = true
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    setAuth0Client({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'ai-inbox', component: { template: '<div />' } }],
    })
    await router.push({ name: 'ai-inbox' })
    await router.isReady()
    push = vi.spyOn(router, 'push').mockResolvedValue()
    store = useInboxStore()
    wrapper = mount(CommandPalette, { attachTo: document.body, global: { plugins: [router] } })
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  // App.vue owns the '/' shortcut and opens the palette through the store.
  it('is hidden until the store opens it, with the first item selected', async () => {
    expect(wrapper.find('.cp-overlay').classes()).not.toContain('active')

    openPalette()
    await wrapper.vm.$nextTick()

    expect(store.isCommandPaletteOpen).toBe(true)
    expect(wrapper.find('.cp-overlay').classes()).toContain('active')
    const items = wrapper.findAll('.cp-item')
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].classes()).toContain('selected')
  })

  it("leaves the '/' shortcut to App instead of listening for it itself", async () => {
    pressSlash()
    await wrapper.vm.$nextTick()

    expect(store.isCommandPaletteOpen).toBe(false)
  })

  // A focused (hidden) input would count as typing and block App's '/'.
  it('releases the hidden input so the keyboard shortcut can reopen the palette', async () => {
    openPalette()
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.cp-input')
    input.element.focus()
    await input.trigger('keydown', { key: 'Enter' })
    expect(document.activeElement).not.toBe(input.element)
    expect(store.isCommandPaletteOpen).toBe(false)
  })

  it("typing '/' inside the palette input does not close it", async () => {
    openPalette()
    await wrapper.vm.$nextTick()

    pressSlash(wrapper.find('.cp-input').element)
    await wrapper.vm.$nextTick()

    expect(store.isCommandPaletteOpen).toBe(true)
  })

  it('typing filters the command list', async () => {
    openPalette()
    await wrapper.vm.$nextTick()

    await wrapper.find('.cp-input').setValue('open settings')

    const items = wrapper.findAll('.cp-item')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('Open Settings')
  })

  it('arrow keys move the selection and Enter runs the command', async () => {
    openPalette()
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

  it('does not offer an unfinished move command', async () => {
    const email = { id: 'e1', unread: false, starred: false, labels: [] }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    openPalette()
    await wrapper.vm.$nextTick()

    const input = wrapper.find('.cp-input')
    await input.setValue('move to')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.find('.cp-no-results').exists()).toBe(true)
    expect(store.isCommandPaletteOpen).toBe(true)
    // The email itself is untouched.
    expect(store.traditionalEmails).toHaveLength(1)
  })

  it('Escape closes the palette without touching the open email', async () => {
    const email = { id: 'e1', unread: false, starred: false, labels: [] }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    openPalette()
    await wrapper.vm.$nextTick()

    await wrapper.find('.cp-input').trigger('keydown', { key: 'Escape' })

    expect(store.isCommandPaletteOpen).toBe(false)
    expect(store.openEmailId).toBe('e1')
  })

  it('shows email commands with keycap hints when an email is open', async () => {
    const email = { id: 'e1', unread: true, starred: false, labels: [] }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    openPalette()
    await wrapper.vm.$nextTick()

    const first = wrapper.findAll('.cp-item')[0]
    expect(first.text()).toContain('Mark Done')
    expect(first.find('.cp-keycap').text()).toBe('D')
  })
})
