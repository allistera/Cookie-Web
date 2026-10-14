import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import BucketPanel from '../BucketPanel.vue'
import { bucketStorageKey } from '../../lib/bucketItems'
import { useBucketsStore } from '../../stores/buckets'
import { useInboxStore } from '../../stores/inbox'

const DAY = 24 * 60 * 60 * 1000
// Tuesday 13 October 2026, 09:50 local time.
const NOW = new Date(2026, 9, 13, 9, 50)

const email = {
  kind: 'email',
  id: 'msg-1',
  title: 'Re: Acme MSA — redlines v3',
  meta: { sender: 'Jamie Reid', sentAt: new Date(2026, 9, 13, 9, 42).toISOString() },
}
const event = {
  kind: 'event',
  id: 'ev-1',
  title: 'Acme legal sync',
  meta: { date: '2026-10-15', start: '14:00', duration: 30, allDay: false },
}

let router
let store
let wrapper

async function render() {
  wrapper = mount(BucketPanel, { attachTo: document.body, global: { plugins: [router] } })
  await nextTick()
  return wrapper
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.clear()
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/inbox', component: { template: '<div />' } },
      { path: '/calendar', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  setActivePinia(createPinia())
  store = useBucketsStore()
  store.setOwner('auth0|me')
  store.togglePin(email)
  store.togglePin(event)
  store.open()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  localStorage.clear()
})

describe('BucketPanel', () => {
  it('lists the pinned items with where each opens', async () => {
    await render()
    expect(wrapper.text()).toContain('2 items')
    expect(wrapper.text()).toContain('Clears in 3 days')
    const links = wrapper.findAll('a.bucket-item-link')
    expect(links.map((link) => link.get('.bucket-item-text').text())).toEqual([
      'Re: Acme MSA — redlines v3Jamie Reid · 09:42',
      'Acme legal syncThu 14:00-14:30',
    ])
    expect(links.map((link) => link.get('.material-symbols-outlined').text())).toEqual([
      'mail',
      'calendar_month',
    ])
    expect(links[0].attributes('href')).toBe('/inbox?open=msg-1')
    expect(links[1].attributes('href')).toBe('/calendar?date=2026-10-15&event=ev-1')

    await links[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/calendar?date=2026-10-15&event=ev-1')
    expect(store.isOpen).toBe(false)
  })

  it('names the bucket by typing on its title', async () => {
    await render()
    const title = wrapper.get('input[aria-label="Bucket name"]')
    expect(document.activeElement).toBe(title.element)
    await title.setValue('Acme contract review')
    expect(store.bucket.title).toBe('Acme contract review')
    expect(JSON.parse(localStorage.getItem(bucketStorageKey('auth0|me'))).title).toBe(
      'Acme contract review',
    )
  })

  it('changes the icon from the picker', async () => {
    await render()
    await wrapper.get('button[aria-label="Change bucket icon"]').trigger('click')
    await wrapper.get('[role="tab"][aria-controls]:nth-child(2)').trigger('click')
    const smile = wrapper.findAll('.composer-emoji-item').find((button) => button.text() === '😀')
    await smile.trigger('click')
    expect(store.bucket.icon).toBe('😀')
  })

  it('removes one item, and Done removes the bucket with an undo', async () => {
    const inbox = useInboxStore()
    await render()
    await wrapper
      .get('button[aria-label="Remove Acme legal sync from the bucket"]')
      .trigger('click')
    expect(store.items).toEqual([email])
    expect(wrapper.text()).toContain('1 item')

    await wrapper.get('button.bucket-done').trigger('click')
    expect(store.hasBucket).toBe(false)
    expect(store.isOpen).toBe(false)
    expect(localStorage.getItem(bucketStorageKey('auth0|me'))).toBeNull()
    expect(inbox.toasts.at(-1)).toMatchObject({ message: 'Bucket cleared.' })
    await inbox.runToastAction(inbox.toasts.at(-1).id)
    expect(store.items).toEqual([email])
  })

  it('restarts the clearing time from the menu', async () => {
    await render()
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')
    await wrapper.get('[role="menuitem"]:nth-child(3)').trigger('click')
    expect(store.bucket.expiresAt).toBe(NOW.getTime() + 7 * DAY)
    expect(wrapper.text()).toContain('Clears in 7 days')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('closes on its close button, Escape and a click outside, but not on the header button', async () => {
    await render()
    await wrapper.get('button[aria-label="Close bucket"]').trigger('click')
    expect(store.isOpen).toBe(false)
    expect(store.hasBucket).toBe(true)

    store.open()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(store.isOpen).toBe(false)

    store.open()
    const trigger = document.createElement('button')
    trigger.className = 'bucket-trigger'
    document.body.append(trigger)
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(store.isOpen).toBe(true)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(store.isOpen).toBe(false)
    trigger.remove()
  })

  it('leaves Escape to whatever is open above it', async () => {
    const inbox = useInboxStore()
    await render()
    const escape = () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    inbox.isCommandPaletteOpen = true
    escape()
    expect(store.isOpen).toBe(true)
    inbox.isCommandPaletteOpen = false

    inbox.isShortcutsHelpOpen = true
    escape()
    expect(store.isOpen).toBe(true)
    inbox.isShortcutsHelpOpen = false

    // The icon picker's popover closes on its own Escape; the panel stays.
    await wrapper.get('button[aria-label="Change bucket icon"]').trigger('click')
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(true)
    await wrapper.get('.composer-emoji-popover input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)
    expect(store.isOpen).toBe(true)

    escape()
    expect(store.isOpen).toBe(false)
  })

  it('shows an empty bucket how to fill it', async () => {
    store.removeItem('email:msg-1')
    store.removeItem('event:ev-1')
    await render()
    expect(wrapper.text()).toContain('0 items')
    expect(wrapper.text()).toContain('press B')
  })
})
