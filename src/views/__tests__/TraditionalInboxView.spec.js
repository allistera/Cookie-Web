import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import TraditionalInboxView from '../TraditionalInboxView.vue'
import { useInboxStore } from '../../stores/inbox'

// The view reads route.query.filter; mutate routeMock.query per test.
const routeMock = { query: {} }
vi.mock('vue-router', () => ({ useRoute: () => routeMock }))

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function makeEmail(id, sentAt) {
  return {
    id,
    sender: `Sender ${id}`,
    address: `sender-${id}@example.com`,
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    body: 'Body',
    date: '10:00',
    sentAt: new Date(sentAt).toISOString(),
    unread: true,
    starred: false,
    labels: [],
  }
}

describe('TraditionalInboxView day accordion', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('yesterday-1', Date.now() - DAY),
      makeEmail('earlier-1', Date.now() - 10 * DAY),
    ]
  })

  function groupHeader(wrapper, label) {
    return wrapper
      .findAll('.ni-group-header')
      .find((header) => header.text().includes(label))
  }

  it('shows only Today expanded by default', () => {
    const wrapper = mount(TraditionalInboxView)

    const headers = wrapper.findAll('.ni-group-header').map((h) => h.text())
    expect(headers).toHaveLength(3)
    expect(headers[0]).toContain('Today')
    expect(headers[1]).toContain('Yesterday')
    expect(headers[2]).toContain('Earlier')

    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject today-1')

    expect(groupHeader(wrapper, 'Today').attributes('aria-expanded')).toBe('true')
    expect(groupHeader(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
  })

  it('expands a closed group on header click', async () => {
    const wrapper = mount(TraditionalInboxView)

    await groupHeader(wrapper, 'Yesterday').trigger('click')

    const rows = wrapper.findAll('.ni-row').map((r) => r.text())
    expect(rows).toHaveLength(2)
    expect(rows.some((text) => text.includes('Subject yesterday-1'))).toBe(true)
  })

  it('collapses Today on header click', async () => {
    const wrapper = mount(TraditionalInboxView)

    await groupHeader(wrapper, 'Today').trigger('click')

    expect(wrapper.findAll('.ni-row')).toHaveLength(0)
    expect(groupHeader(wrapper, 'Today').attributes('aria-expanded')).toBe('false')
  })

  it('shows the unread count in a group header', () => {
    const wrapper = mount(TraditionalInboxView)

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').text()).toBe('1')
  })

  it('counts only unread emails, not the group total', () => {
    store.traditionalEmails = [
      { ...makeEmail('y-unread', Date.now() - DAY), unread: true },
      { ...makeEmail('y-read', Date.now() - DAY), unread: false },
    ]
    const wrapper = mount(TraditionalInboxView)

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').text()).toBe('1')
  })

  it('hides the count badge when a group has no unread emails', () => {
    store.traditionalEmails = [{ ...makeEmail('y-read', Date.now() - DAY), unread: false }]
    const wrapper = mount(TraditionalInboxView)

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').exists()).toBe(false)
  })
})

describe('TraditionalInboxView group Mark Read tooltip', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    store.traditionalEmails = [
      { ...makeEmail('y-unread-1', Date.now() - DAY), unread: true },
      { ...makeEmail('y-unread-2', Date.now() - DAY - HOUR), unread: true },
      { ...makeEmail('y-read', Date.now() - DAY - 2 * HOUR), unread: false },
    ]
    store.unreadInboxCount = 2
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function header(wrapper, label) {
    return wrapper.findAll('.ni-group-header').find((h) => h.text().includes(label))
  }

  it('renders a Mark Read tooltip button inside the unread count badge', () => {
    const wrapper = mount(TraditionalInboxView)

    const markRead = header(wrapper, 'Yesterday').find('.ni-group-mark-read')
    expect(markRead.exists()).toBe(true)
    expect(markRead.text()).toContain('Mark Read')
    expect(markRead.attributes('role')).toBe('button')
  })

  it('clicking Mark Read marks every unread email of that day as read', async () => {
    const wrapper = mount(TraditionalInboxView)

    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')

    expect(store.traditionalEmails.every((e) => !e.unread)).toBe(true)
    expect(store.unreadInboxCount).toBe(0)
    // The badge (and with it the tooltip) disappears once nothing is unread.
    await wrapper.vm.$nextTick()
    expect(header(wrapper, 'Yesterday').find('.ni-group-count').exists()).toBe(false)
  })

  it('clicking Mark Read does not toggle the group accordion', async () => {
    const wrapper = mount(TraditionalInboxView)

    expect(header(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')
    expect(header(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
  })

  it('only touches emails of its own day group', async () => {
    store.traditionalEmails.push({ ...makeEmail('today-unread', Date.now() - HOUR), unread: true })
    store.unreadInboxCount = 3
    const wrapper = mount(TraditionalInboxView)

    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')

    expect(store.traditionalEmails.find((e) => e.id === 'today-unread').unread).toBe(true)
    expect(store.traditionalEmails.find((e) => e.id === 'y-unread-1').unread).toBe(false)
    expect(store.unreadInboxCount).toBe(1)
  })
})

describe('TraditionalInboxView filtered views', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    const starred = makeEmail('starred-1', Date.now() - HOUR)
    starred.starred = true
    const labeled = makeEmail('labeled-1', Date.now() - HOUR)
    labeled.labels = [{ name: 'Home', color: '#ff0000' }]
    store.traditionalEmails = [makeEmail('plain-1', Date.now() - HOUR), starred, labeled]
  })

  it('filter=starred shows only starred emails with a Starred header', () => {
    routeMock.query = { filter: 'starred' }
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Starred')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject starred-1')
  })

  it('filter=label shows only emails carrying that label', () => {
    routeMock.query = { filter: 'label', label: 'Home' }
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Home')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject labeled-1')
  })

  it('filter=snoozed shows an empty state and hides Load more', () => {
    routeMock.query = { filter: 'snoozed' }
    store.hasMoreEmails = true
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Snoozed')
    expect(wrapper.findAll('.ni-row')).toHaveLength(0)
    expect(wrapper.find('.ni-empty').text()).toBe('No snoozed emails yet.')
    expect(wrapper.find('.ni-load-more').exists()).toBe(false)
  })

  it('an unknown filter falls back to the full inbox', () => {
    routeMock.query = { filter: 'bogus' }
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Inbox')
    expect(wrapper.findAll('.ni-row')).toHaveLength(3)
  })
})

describe('TraditionalInboxView reading panel', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clicking a row opens the reader through the store', async () => {
    const wrapper = mount(TraditionalInboxView)

    await wrapper.find('.ni-row').trigger('click')
    expect(store.openEmailId).toBe('today-1')
    expect(wrapper.find('.ni-reader').exists()).toBe(true)
  })

  it('closes the reader when the open email is archived from outside the view', async () => {
    const wrapper = mount(TraditionalInboxView)

    await wrapper.find('.ni-row').trigger('click')
    store.archiveEmail(store.openEmail)
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })
})

describe("TraditionalInboxView 'd' archive shortcut", () => {
  let store
  let wrapper

  function pressD(init = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, ...init }))
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.spyOn(store, 'archiveEmail')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
    wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("archives the open email when 'd' is pressed and closes the reader when it was the only email", () => {
    pressD()

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
    expect(store.openEmailId).toBe(null)
  })

  it('advances to the next email in the list after archiving', async () => {
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
      makeEmail('today-3', Date.now() - 3 * HOUR),
    ]
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ni-row')[0].trigger('click')

    pressD()

    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
    expect(store.openEmailId).toBe('today-2')
  })

  it('falls back to the previous email when the archived one was last', async () => {
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
    ]
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ni-row')[1].trigger('click')

    pressD()

    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-2')
    expect(store.openEmailId).toBe('today-1')
  })

  it('does nothing when no email is open', () => {
    store.closeReader()

    pressD()

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })

  it("ignores 'd' typed into an input or textarea", () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    try {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    } finally {
      textarea.remove()
    }

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })

  it("ignores 'd' while the command palette is open", () => {
    store.isCommandPaletteOpen = true

    pressD()

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })

  it("ignores auto-repeated 'd' events from a held key (one press = one archive)", async () => {
    // With auto-advance, each archive opens the next (unseen) email — a held
    // key must not chain-archive mail the user never looked at.
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
      makeEmail('today-3', Date.now() - 3 * HOUR),
    ]
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ni-row')[0].trigger('click')

    pressD()
    pressD({ repeat: true })
    pressD({ repeat: true })

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.openEmailId).toBe('today-2')
  })

  it("ignores 'd' with a modifier key held (browser shortcuts like Cmd+D)", () => {
    pressD({ metaKey: true })
    pressD({ ctrlKey: true })
    pressD({ altKey: true })

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })
})
