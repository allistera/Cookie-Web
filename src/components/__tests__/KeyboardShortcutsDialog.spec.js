import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import KeyboardShortcutsDialog from '../KeyboardShortcutsDialog.vue'
import { useInboxStore } from '../../stores/inbox'

let store
let wrapper

function press(key, target = document.body, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('KeyboardShortcutsDialog', () => {
  it('renders nothing while closed', () => {
    wrapper = mount(KeyboardShortcutsDialog, { attachTo: document.body })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('lists the shortcuts by where they work', async () => {
    store.isShortcutsHelpOpen = true
    wrapper = mount(KeyboardShortcutsDialog, { attachTo: document.body })
    await nextTick()

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(wrapper.findAll('h3').map((h) => h.text())).toEqual([
      'General',
      'Email list',
      'Ticked emails',
      'Open email',
    ])
    expect(dialog.text()).toContain('Open the highlighted email')
    const markRead = wrapper.findAll('.ks-row').find((row) => row.text().includes('Mark read'))
    expect(markRead.findAll('kbd').map((k) => k.text())).toEqual(['Shift', 'I'])
    expect(markRead.text()).toContain('+')
  })

  it('focuses the close button on open and gives focus back on close', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    wrapper = mount(KeyboardShortcutsDialog, { attachTo: document.body })

    store.isShortcutsHelpOpen = true
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('.ks-close').element)

    await wrapper.get('.ks-close').trigger('click')
    await nextTick()
    expect(store.isShortcutsHelpOpen).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape without letting the key reach page shortcuts', async () => {
    let reached = false
    const listener = () => (reached = true)
    document.addEventListener('keydown', listener)
    store.isShortcutsHelpOpen = true
    wrapper = mount(KeyboardShortcutsDialog, { attachTo: document.body })
    await nextTick()

    const event = press('Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(store.isShortcutsHelpOpen).toBe(false)
    expect(reached).toBe(false)
    document.removeEventListener('keydown', listener)
  })

  it('closes on ? and keeps other keys from page shortcuts while open', async () => {
    let reached = 0
    const listener = () => reached++
    document.addEventListener('keydown', listener)
    store.isShortcutsHelpOpen = true
    wrapper = mount(KeyboardShortcutsDialog, { attachTo: document.body })
    await nextTick()

    press('e')
    expect(reached).toBe(0)
    expect(store.isShortcutsHelpOpen).toBe(true)

    press('?', document.body, { shiftKey: true })
    expect(store.isShortcutsHelpOpen).toBe(false)

    // Once closed, keys go back to the page.
    press('e')
    expect(reached).toBe(1)
    document.removeEventListener('keydown', listener)
  })

  it('closes when the backdrop is pressed', async () => {
    store.isShortcutsHelpOpen = true
    wrapper = mount(KeyboardShortcutsDialog, { attachTo: document.body })
    await nextTick()

    await wrapper.get('.ks-overlay').trigger('mousedown')
    expect(store.isShortcutsHelpOpen).toBe(false)
  })
})
