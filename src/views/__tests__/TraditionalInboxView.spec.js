import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import TraditionalInboxView from '../TraditionalInboxView.vue'
import { useInboxStore } from '../../stores/inbox'
import { scheduleChoices } from '../../utils/schedule'

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

  it('shows due scheduled emails in an expanded Due Today group above Today', () => {
    const due = makeEmail('due-1', Date.now() - 5 * DAY)
    due.scheduledFor = new Date(Date.now() - HOUR).toISOString()
    store.traditionalEmails.unshift(due)

    const wrapper = mount(TraditionalInboxView)
    const headers = wrapper.findAll('.ni-group-header').map((header) => header.text())

    expect(headers[0]).toContain('Due Today')
    expect(headers[1]).toContain('Today')
    expect(groupHeader(wrapper, 'Due Today').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.ni-row')[0].text()).toContain('Subject due-1')
  })

  it('does not render Due Today when no scheduled emails are due', () => {
    const wrapper = mount(TraditionalInboxView)

    expect(groupHeader(wrapper, 'Due Today')).toBeUndefined()
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 14, 12))
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    const starred = makeEmail('starred-1', Date.now() - HOUR)
    starred.starred = true
    const labeled = makeEmail('labeled-1', Date.now() - HOUR)
    labeled.labels = [{ name: 'Home', color: '#ff0000' }]
    store.traditionalEmails = [makeEmail('plain-1', Date.now() - HOUR), starred, labeled]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('filter=starred shows only starred emails with a Starred header', () => {
    routeMock.query = { filter: 'starred' }
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Starred')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject starred-1')
  })

  it('hides starred emails from the inbox', () => {
    const wrapper = mount(TraditionalInboxView)

    const rows = wrapper.findAll('.ni-row').map((row) => row.text())
    expect(rows).toHaveLength(2)
    expect(rows.some((text) => text.includes('Subject starred-1'))).toBe(false)
  })

  it('moves an email from the inbox to the Starred folder as soon as it is starred', async () => {
    let wrapper = mount(TraditionalInboxView)

    await wrapper.find('.ni-row [title="Star"]').trigger('click')

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).not.toContain(
      expect.stringContaining('Subject plain-1'),
    )

    wrapper.unmount()
    routeMock.query = { filter: 'starred' }
    wrapper = mount(TraditionalInboxView)

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject plain-1'),
    )
  })

  it('keeps starred matches visible in search results', () => {
    store.activeSearchQuery = 'starred'

    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject starred-1'),
    )
  })

  it('closes the reader when its email is starred from outside the row', async () => {
    const wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')

    store.toggleStar(store.openEmail)
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })

  it('filter=label shows only emails carrying that label', () => {
    routeMock.query = { filter: 'label', label: 'Home' }
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Home')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject labeled-1')
  })

  it('filter=snoozed groups future emails by snooze target with both groups open', () => {
    routeMock.query = { filter: 'snoozed' }
    const [tomorrow, nextWeek] = scheduleChoices()
    const tomorrowEmail = makeEmail('tomorrow-1', Date.now() - 10 * DAY)
    tomorrowEmail.scheduledFor = tomorrow.date.toISOString()
    const nextWeekEmail = makeEmail('next-week-1', Date.now() - HOUR)
    nextWeekEmail.scheduledFor = nextWeek.date.toISOString()
    store.snoozedEmails = [nextWeekEmail, tomorrowEmail]
    vi.spyOn(store, 'loadSnoozedEmails').mockResolvedValue()
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Snoozed')
    expect(store.loadSnoozedEmails).toHaveBeenCalledTimes(1)
    const headers = wrapper.findAll('.ni-group-header')
    expect(headers.map((header) => header.text())).toEqual([
      expect.stringContaining('Tomorrow'),
      expect.stringContaining('Next Week'),
    ])
    expect(headers.every((header) => header.attributes('aria-expanded') === 'true')).toBe(true)
    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toEqual([
      expect.stringContaining('Subject tomorrow-1'),
      expect.stringContaining('Subject next-week-1'),
    ])
  })

  it('an unknown filter falls back to the unstarred inbox', () => {
    routeMock.query = { filter: 'bogus' }
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Inbox')
    expect(wrapper.findAll('.ni-row')).toHaveLength(2)
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

describe('TraditionalInboxView multi-select', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
      makeEmail('today-3', Date.now() - 3 * HOUR),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function checkbox(wrapper, index) {
    return wrapper.findAll('.ni-row .ni-checkbox')[index]
  }

  it('clicking a row checkbox selects it without opening the reader', async () => {
    const wrapper = mount(TraditionalInboxView)

    await checkbox(wrapper, 0).trigger('click')

    expect(checkbox(wrapper, 0).attributes('aria-checked')).toBe('true')
    expect(checkbox(wrapper, 0).text()).toContain('check_box')
    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-bulk-bar').text()).toContain('1 selected')
  })

  it('selecting several shows the count and the three bulk pills', async () => {
    const wrapper = mount(TraditionalInboxView)

    await checkbox(wrapper, 0).trigger('click')
    await checkbox(wrapper, 1).trigger('click')

    const bar = wrapper.find('.ni-bulk-bar')
    expect(bar.text()).toContain('2 selected')
    const pills = bar.findAll('.ni-bulk-pill').map((p) => p.text())
    expect(pills.some((t) => t.includes('Star'))).toBe(true)
    expect(pills.some((t) => t.includes('Done'))).toBe(true)
    expect(pills.some((t) => t.includes('Reschedule'))).toBe(true)
  })

  it('the bulk Reschedule pill offers Tomorrow and Next Week', async () => {
    const wrapper = mount(TraditionalInboxView)
    await checkbox(wrapper, 0).trigger('click')

    await wrapper
      .findAll('.ni-bulk-pill')
      .find((pill) => pill.text().includes('Reschedule'))
      .trigger('click')

    const choices = wrapper.findAll('.ni-schedule-menu [role="menuitem"]')
    expect(choices.map((choice) => choice.text())).toEqual([
      expect.stringContaining('Tomorrow'),
      expect.stringContaining('Next Week'),
    ])
  })

  it('the Done pill archives every selected email and hides the bar', async () => {
    vi.spyOn(useInboxStore(), 'archiveEmail')
    const wrapper = mount(TraditionalInboxView)

    await checkbox(wrapper, 0).trigger('click')
    await checkbox(wrapper, 1).trigger('click')
    await wrapper
      .findAll('.ni-bulk-pill')
      .find((p) => p.text().includes('Done'))
      .trigger('click')

    expect(store.archiveEmail).toHaveBeenCalledTimes(2)
    const ids = store.archiveEmail.mock.calls.map(([email]) => email.id)
    expect(ids.sort()).toEqual(['today-1', 'today-2'])
    expect(wrapper.find('.ni-bulk-bar').exists()).toBe(false)
  })

  it('the Star pill stars every selected email and clears the selection', async () => {
    const wrapper = mount(TraditionalInboxView)

    await checkbox(wrapper, 0).trigger('click')
    await checkbox(wrapper, 1).trigger('click')
    await wrapper
      .findAll('.ni-bulk-pill')
      .find((p) => p.text().includes('Star'))
      .trigger('click')

    expect(store.traditionalEmails.find((e) => e.id === 'today-1').starred).toBe(true)
    expect(store.traditionalEmails.find((e) => e.id === 'today-2').starred).toBe(true)
    expect(store.traditionalEmails.find((e) => e.id === 'today-3').starred).toBe(false)
    expect(wrapper.find('.ni-bulk-bar').exists()).toBe(false)
  })

  it('Escape clears the selection first and only then closes the reader', async () => {
    const wrapper = mount(TraditionalInboxView)
    await wrapper.findAll('.ni-row')[2].trigger('click')
    await checkbox(wrapper, 0).trigger('click')
    expect(store.openEmailId).toBe('today-3')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ni-bulk-bar').exists()).toBe(false)
    expect(checkbox(wrapper, 0).attributes('aria-checked')).toBe('false')
    expect(store.openEmailId).toBe('today-3')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(store.openEmailId).toBe(null)

    wrapper.unmount()
  })
})

describe('TraditionalInboxView Done action (replaces Archive/Delete)', () => {
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
    vi.restoreAllMocks()
  })

  it('rows offer a single Done action with a checkbox icon and no Delete or Archive', () => {
    const wrapper = mount(TraditionalInboxView)
    const row = wrapper.find('.ni-row')

    const done = row.find('[title="Done"]')
    expect(done.exists()).toBe(true)
    expect(done.text()).toContain('check_box')
    expect(row.find('[title="Delete"]').exists()).toBe(false)
    expect(row.find('[title="Archive"]').exists()).toBe(false)
  })

  it('clicking Done archives the email', async () => {
    vi.spyOn(useInboxStore(), 'archiveEmail')
    const wrapper = mount(TraditionalInboxView)

    await wrapper.find('.ni-row [title="Done"]').trigger('click')

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
  })

  it('the reader topbar offers Star, Done and Reschedule with no Delete or Archive', async () => {
    const wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')

    const topbar = wrapper.find('.ni-reader-topbar')
    const star = topbar.find('[title="Star"]')
    const done = topbar.find('[title="Done"]')
    const reschedule = topbar.find('[title="Reschedule"]')
    expect(star.exists()).toBe(true)
    expect(star.text()).toContain('star_border')
    expect(done.exists()).toBe(true)
    expect(done.text()).toContain('check_box')
    expect(reschedule.exists()).toBe(true)
    expect(reschedule.text()).toContain('schedule')
    expect(topbar.find('[title="Delete"]').exists()).toBe(false)
    expect(topbar.find('[title="Archive"]').exists()).toBe(false)
  })

  it('the reader Star action stars the open email', async () => {
    vi.spyOn(store, 'toggleStar')
    const wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Star"]').trigger('click')

    expect(store.toggleStar).toHaveBeenCalledTimes(1)
    expect(store.toggleStar.mock.calls[0][0].id).toBe('today-1')
  })

  it('the reader Reschedule action schedules the email for Tomorrow', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    const wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Reschedule"]').trigger('click')
    const choices = wrapper.findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
    expect(choices.map((choice) => choice.text())).toEqual([
      expect.stringContaining('Tomorrow'),
      expect.stringContaining('Next Week'),
    ])
    await choices[0].trigger('click')

    await vi.waitFor(() => {
      const patchRequest = fetch.mock.calls.find(([, options]) => {
        if (options?.method !== 'PATCH') return false
        return Object.hasOwn(JSON.parse(options.body), 'scheduled_for')
      })
      expect(JSON.parse(patchRequest[1].body)).toMatchObject({
        id: 'today-1',
        scheduled_for: expect.any(String),
      })
    })
    await vi.waitFor(() => {
      expect(store.toasts.some((toast) => toast.message === 'Scheduled for Tomorrow.')).toBe(true)
      expect(store.traditionalEmails).toHaveLength(0)
    })
  })
})

describe('TraditionalInboxView placeholder controls (rage-click fix)', () => {
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

  it('rows offer no Snooze action', () => {
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-row [title="Snooze"]').exists()).toBe(false)
  })

  it('the reader has no Snooze, More or Forward controls', async () => {
    const wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')

    const reader = wrapper.find('.ni-reader')
    expect(reader.find('[title="Snooze"]').exists()).toBe(false)
    expect(reader.find('[title="More"]').exists()).toBe(false)
    expect(reader.find('[title="Forward"]').exists()).toBe(false)

    const pills = reader.findAll('.ni-reader-footer .ni-pill-btn')
    expect(pills).toHaveLength(1)
    expect(pills[0].text()).toContain('Reply')
  })

  it('keeps the working reader controls', async () => {
    const wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')

    const reader = wrapper.find('.ni-reader')
    expect(reader.find('[title="Reply"]').exists()).toBe(true)
    expect(reader.find('[title="Star"]').exists()).toBe(true)
    expect(reader.find('[title="Done"]').exists()).toBe(true)
    expect(reader.find('[title="Reschedule"]').exists()).toBe(true)
    expect(reader.find('[title="Close"]').exists()).toBe(false)
    expect(reader.find('[title="Previous"]').exists()).toBe(false)
    expect(reader.find('[title="Next"]').exists()).toBe(false)
  })
})

describe('TraditionalInboxView newsletter unsubscribe', () => {
  let store
  let wrapper
  let fetchMock

  const UNSUB = { oneClick: true, url: 'https://news.example/unsub', mailto: null }

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('news-1', Date.now() - HOUR)]
    // Auth0 is absent in tests; getAccessTokenSilently would throw in jsdom.
    vi.spyOn(store, 'authHeaders').mockResolvedValue({ 'Content-Type': 'application/json' })
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function openReader(unsubscribe) {
    store.messageBodies.set('news-1', { html: null, text: 'Body', unsubscribe })
    wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')
    return wrapper.find('.ni-reader')
  }

  it('shows an Unsubscribe button when the open email advertises List-Unsubscribe', async () => {
    const reader = await openReader(UNSUB)

    const button = reader.find('[title="Unsubscribe"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Unsubscribe')
  })

  it('hides the Unsubscribe button for a regular email', async () => {
    const reader = await openReader(null)

    expect(reader.find('[title="Unsubscribe"]').exists()).toBe(false)
  })

  it('posts the unsubscribe action and reports success', async () => {
    const reader = await openReader(UNSUB)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'unsubscribed', method: 'one-click' }),
    })

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.message.includes('Unsubscribed'))).toBe(true)
    })

    const [url, options] = fetchMock.mock.calls.at(-1)
    expect(url).toBe('/api/messages')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ id: 'news-1', action: 'unsubscribe' })

    // The button reflects the completed state and can't fire twice.
    const button = wrapper.find('.ni-reader [title="Unsubscribe"]')
    expect(button.text()).toContain('Unsubscribed')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('opens the unsubscribe page when the sender only offers a link', async () => {
    const reader = await openReader({ oneClick: false, url: 'https://news.example/unsub', mailto: null })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'manual', method: 'link', url: 'https://news.example/unsub' }),
    })
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://news.example/unsub', '_blank', 'noopener')
    })
  })

  it('surfaces an error toast when the unsubscribe request fails', async () => {
    const reader = await openReader(UNSUB)
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) })

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.kind === 'error')).toBe(true)
    })
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
