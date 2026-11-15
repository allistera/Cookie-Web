import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import WindowDock from '../WindowDock.vue'
import { useInboxStore } from '../../stores/inbox'

let router
let store
let wrapper

const emailTab = {
  key: 'email:m1',
  kind: 'email',
  item: { kind: 'email', id: 'm1', title: 'Revised floor plan', meta: { folder: 'sent' } },
}

function minimisedMessage(key, subject) {
  return { key, kind: 'compose', snapshot: { subject, to: '', text: 'Words.', html: '' } }
}

async function render() {
  wrapper = mount(WindowDock, { attachTo: document.body, global: { plugins: [router] } })
  await nextTick()
  return wrapper
}

function tab(title) {
  return wrapper.findAll('.window-dock-tab').find((entry) => entry.text().includes(title))
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/inbox', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  setActivePinia(createPinia())
  store = useInboxStore()
})

afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

describe('WindowDock', () => {
  it('lists every tab by subject and marks the open ones', async () => {
    store.dockTabs = [
      minimisedMessage('compose:1', 'Quarterly numbers'),
      { key: 'compose:2', kind: 'compose', snapshot: null },
      emailTab,
    ]
    store.composerTabKey = 'compose:2'
    store.composerSubject = 'Lunch on Friday'
    await render()

    const titles = wrapper.findAll('.window-dock-label').map((label) => label.text())
    expect(titles).toEqual(['Quarterly numbers', 'Lunch on Friday', 'Revised floor plan'])
    const pressed = wrapper
      .findAll('.window-dock-title')
      .map((button) => button.attributes('aria-pressed'))
    expect(pressed).toEqual(['false', 'true', 'false'])

    // The open message's tab follows its subject as it is typed.
    store.composerSubject = 'Lunch on Thursday'
    await nextTick()
    expect(tab('Lunch on Thursday').exists()).toBe(true)
  })

  it('stays out of the way while the only tab is the open message', async () => {
    store.dockTabs = [{ key: 'compose:1', kind: 'compose', snapshot: null }]
    store.composerTabKey = 'compose:1'
    await render()
    expect(wrapper.find('.window-dock').exists()).toBe(false)

    store.dockTabs = [minimisedMessage('compose:1', 'Quarterly numbers')]
    store.composerTabKey = null
    await nextTick()
    expect(wrapper.find('.window-dock').exists()).toBe(true)
  })

  it('brings a minimised message back, and puts the open one away', async () => {
    store.dockTabs = [
      minimisedMessage('compose:1', 'Quarterly numbers'),
      { key: 'compose:2', kind: 'compose', snapshot: null },
    ]
    store.composerTabKey = 'compose:2'
    const open = vi.spyOn(store, 'openComposerTab').mockImplementation(() => {})
    const minimise = vi.spyOn(store, 'minimizeComposer').mockImplementation(() => {})
    await render()

    await tab('Quarterly numbers').get('.window-dock-title').trigger('click')
    expect(open).toHaveBeenCalledWith('compose:1')

    await tab('New message').get('.window-dock-title').trigger('click')
    expect(minimise).toHaveBeenCalledOnce()
  })

  it('opens an email tab in the folder it came from, and asks again each time', async () => {
    store.dockTabs = [emailTab, minimisedMessage('compose:1', 'Quarterly numbers')]
    await render()

    await tab('Revised floor plan').get('.window-dock-title').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/inbox?filter=sent&open=m1')
    expect(store.emailOpenRequests).toBe(1)

    // Open in the reader: the same tab puts it away rather than navigating.
    store.openEmailId = 'm1'
    await nextTick()
    await tab('Revised floor plan').get('.window-dock-title').trigger('click')
    expect(store.openEmailId).toBeNull()
    expect(store.emailOpenRequests).toBe(1)
  })

  it('closes the open message with its tab, and only the tab otherwise', async () => {
    store.dockTabs = [
      minimisedMessage('compose:1', 'Quarterly numbers'),
      { key: 'compose:2', kind: 'compose', snapshot: null },
      emailTab,
    ]
    store.composerTabKey = 'compose:2'
    store.openEmailId = 'm1'
    const closeComposer = vi.spyOn(store, 'closeComposer').mockImplementation(() => {})
    await render()

    await wrapper.get('[aria-label="Close Quarterly numbers"]').trigger('click')
    expect(store.dockTabs.map((entry) => entry.key)).toEqual(['compose:2', 'email:m1'])
    expect(closeComposer).not.toHaveBeenCalled()

    // An email's tab is only a way back to it: the reader stays open.
    await wrapper.get('[aria-label="Close Revised floor plan"]').trigger('click')
    expect(store.dockTabs.map((entry) => entry.key)).toEqual(['compose:2'])
    expect(store.openEmailId).toBe('m1')

    store.dockTabs = [...store.dockTabs, minimisedMessage('compose:3', 'Holiday plans')]
    await nextTick()
    await wrapper.get('[aria-label="Close New message"]').trigger('click')
    expect(closeComposer).toHaveBeenCalledOnce()
  })
})
