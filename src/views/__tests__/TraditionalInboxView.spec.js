import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import TraditionalInboxView from '../TraditionalInboxView.vue'
import EmailBody from '../../components/EmailBody.vue'
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

  it('shows auto_awesome before the subject only when an email has an AI summary', async () => {
    store.traditionalEmails[0].hasAiSummary = true
    const plainEmail = makeEmail('today-plain', Date.now() - 2 * HOUR)
    plainEmail.labels = [{ name: 'AI Generated', color: '#7c3aed' }]
    store.traditionalEmails.splice(1, 0, plainEmail)
    const wrapper = mount(TraditionalInboxView)

    const generatedRow = wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Subject today-1'))
    const rowSubject = generatedRow.find('.ni-subject')
    expect(rowSubject.find('.ni-ai-generated-icon').text()).toBe('auto_awesome')
    expect(rowSubject.text()).toContain('auto_awesomeSubject today-1')

    const plainRow = wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Subject today-plain'))
    expect(plainRow.find('.ni-ai-generated-icon').exists()).toBe(false)

    await generatedRow.trigger('click')

    const readerSubject = wrapper.find('.ni-reader-subject')
    expect(readerSubject.find('.ni-ai-generated-icon').text()).toBe('auto_awesome')
    expect(readerSubject.text()).toContain('auto_awesomeSubject today-1')
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

  it('filter=done loads the hidden Done mailbox and opens completed emails', async () => {
    routeMock.query = { filter: 'done' }
    store.doneEmails = [makeEmail('done-1', Date.now() - HOUR)]
    vi.spyOn(store, 'loadDonePage').mockResolvedValue()
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Done')
    expect(store.loadDonePage).toHaveBeenCalledWith(0)
    expect(wrapper.findAll('.ni-row')).toHaveLength(1)
    expect(wrapper.find('.ni-row').text()).toContain('Subject done-1')
    // Done groups by calendar day.
    expect(wrapper.find('.ni-group-header').text()).toContain('Today')
    expect(wrapper.find('.ni-row [title="Done"]').exists()).toBe(false)

    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader-subject').text()).toBe('Subject done-1')
    expect(wrapper.find('.ni-reader [title="Done"]').exists()).toBe(false)
    expect(wrapper.find('.ni-reader [title="Reschedule"]').exists()).toBe(false)
  })

  it('an unknown filter falls back to the unstarred inbox', () => {
    routeMock.query = { filter: 'bogus' }
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-header h1').text()).toBe('Inbox')
    expect(wrapper.findAll('.ni-row')).toHaveLength(2)
  })
})

describe('TraditionalInboxView AI summary marker across email lists', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    vi.spyOn(store, 'loadSentEmails').mockResolvedValue()
    vi.spyOn(store, 'loadSpamEmails').mockResolvedValue()
    vi.spyOn(store, 'loadSnoozedEmails').mockResolvedValue()
    vi.spyOn(store, 'loadDonePage').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['Inbox', {}, 'traditionalEmails'],
    ['Starred', { filter: 'starred' }, 'traditionalEmails'],
    ['Label', { filter: 'label', label: 'Projects' }, 'traditionalEmails'],
    ['Sent', { filter: 'sent' }, 'sentEmails'],
    ['Spam', { filter: 'spam' }, 'spamEmails'],
    ['Snoozed', { filter: 'snoozed' }, 'snoozedEmails'],
    ['Done', { filter: 'done' }, 'doneEmails'],
    ['Search', {}, 'traditionalEmails'],
  ])('shows the AI icon in the %s list', (_name, query, listName) => {
    routeMock.query = query
    const email = makeEmail(`summary-${listName}`, Date.now() - HOUR)
    email.hasAiSummary = true
    if (query.filter === 'starred') email.starred = true
    if (query.filter === 'label') email.labels = [{ name: 'Projects', color: '#7c3aed' }]
    if (query.filter === 'snoozed') email.scheduledFor = new Date(Date.now() + DAY).toISOString()
    store[listName] = [email]
    if (_name === 'Search') store.activeSearchQuery = 'summary'

    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-row .ni-ai-generated-icon').text()).toBe('auto_awesome')
    wrapper.unmount()
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

  it('welcomes the user to Inbox Zero after the last email is marked Done', async () => {
    const wrapper = mount(TraditionalInboxView)

    expect(wrapper.find('.ni-inbox-zero').exists()).toBe(false)
    await wrapper.find('.ni-row [title="Done"]').trigger('click')

    const inboxZero = wrapper.find('.ni-inbox-zero')
    expect(inboxZero.attributes('role')).toBe('status')
    expect(inboxZero.text()).toContain('Welcome to Inbox Zero')
    expect(inboxZero.find('.ni-inbox-zero-icon').text()).toBe('task_alt')
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

describe('TraditionalInboxView AI summary', () => {
  let store
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    const email = makeEmail('11111111-1111-1111-1111-111111111111', Date.now() - HOUR)
    email.unread = false
    email.labels = [{ name: 'Projects', color: '#7c3aed' }]
    store.traditionalEmails = [email]
    vi.spyOn(store, 'fetchMessageBody').mockResolvedValue(null)
    vi.spyOn(store, 'authHeaders').mockResolvedValue({ 'Content-Type': 'application/json' })
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('disables Summarize while loading and shows the result below the labels', async () => {
    let resolveSummary
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveSummary = resolve
        }),
      ),
    )
    wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')

    const button = wrapper.find('.ni-reader-topbar [title="Summarize"]')
    expect(button.text()).toContain('Summarize')
    await button.trigger('click')

    await vi.waitFor(() => expect(store.isOpenSummaryLoading).toBe(true))
    expect(button.attributes()).toHaveProperty('disabled')
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.text()).toContain('Summarizing…')
    expect(button.find('.ni-summary-spinner').exists()).toBe(true)

    resolveSummary({
      ok: true,
      json: async () => ({ summary: 'The contractor confirmed the Tuesday delivery.' }),
    })
    await vi.waitFor(() => expect(store.isOpenSummaryLoading).toBe(false))

    const summary = wrapper.find('.ni-reader-labels + .ni-summary-box')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('AI summary')
    expect(summary.text()).toContain('The contractor confirmed the Tuesday delivery.')
    expect(button.text()).toContain('Regenerate Summary')
    expect(button.attributes('title')).toBe('Regenerate Summary')
    expect(wrapper.find('.ni-reader-subject .ni-ai-generated-icon').text()).toBe('auto_awesome')
    expect(wrapper.find('.ni-row .ni-ai-generated-icon').text()).toBe('auto_awesome')
  })

  it('shows a saved summary and offers to regenerate it when the reader opens', async () => {
    const email = store.traditionalEmails[0]
    store.messageSummaries.set(email.id, 'A previously saved summary.')
    wrapper = mount(TraditionalInboxView)

    await wrapper.find('.ni-row').trigger('click')

    const summary = wrapper.find('.ni-summary-box')
    const button = wrapper.find('.ni-summarize-btn')
    expect(summary.text()).toContain('A previously saved summary.')
    expect(button.text()).toContain('Regenerate Summary')
    expect(button.attributes('title')).toBe('Regenerate Summary')
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

    const toolbarGroups = reader.findAll('.ni-reader-topbar .ni-reader-nav')
    const button = toolbarGroups[1].find('[title="Unsubscribe"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Unsubscribe')
    expect(toolbarGroups[0].find('[title="Unsubscribe"]').exists()).toBe(false)
  })

  it('shows an Unsubscribe button for a link in the email content', async () => {
    const url = 'https://news.example/preferences/unsubscribe?id=123'
    store.traditionalEmails[0].unread = false
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        body_html: `<p>News</p><p><a href="${url}">Unsubscribe</a></p>`,
        body_text: 'News',
        unsubscribe: null,
      }),
    })
    wrapper = mount(TraditionalInboxView)
    await wrapper.find('.ni-row').trigger('click')
    await vi.waitFor(() => expect(store.isOpenBodyResolved).toBe(true))
    const emailBody = wrapper.findComponent(EmailBody)
    emailBody.vm.$emit('unsubscribe-link', {
      oneClick: false,
      url,
      href: url,
      mailto: null,
      source: 'content',
    })
    await vi.waitFor(() => {
      expect(wrapper.find('.ni-reader [title="Unsubscribe"]').exists()).toBe(true)
    })

    const link = wrapper.find('.ni-reader a[title="Unsubscribe"]')
    expect(link.attributes('href')).toBe(url)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')

    await link.trigger('click')
    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(false)
    expect(store.openEmailId).toBe(null)
  })

  it('hides the Unsubscribe button for a regular email', async () => {
    const reader = await openReader(null)

    expect(reader.find('[title="Unsubscribe"]').exists()).toBe(false)
  })

  it('posts the unsubscribe action, marks the email done, and closes the reader', async () => {
    const reader = await openReader(UNSUB)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'unsubscribed', method: 'one-click' }),
    })

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.message.includes('Unsubscribed'))).toBe(true)
    })

    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(false)
    expect(store.openEmailId).toBe(null)

    const [url, options] = fetchMock.mock.calls.find(
      ([requestUrl, options]) => requestUrl === '/api/messages' && options.method === 'POST',
    )
    expect(url).toBe('/api/messages')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ id: 'news-1', action: 'unsubscribe' })

    expect(wrapper.find('.ni-reader').exists()).toBe(false)
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
    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(false)
    expect(store.openEmailId).toBe(null)
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

  it("keeps 'd' working when a message is opened while a text field was focused", async () => {
    // Reproduces opening a search result: focus is in the search input, and the
    // clicked row is a non-focusable div, so focus would otherwise stay there
    // and swallow 'd' as typing.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await wrapper.find('.ni-row').trigger('click') // opens the reader

    // The keydown originates from whatever is focused now.
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    expect(store.archiveEmail).toHaveBeenCalled()

    input.remove()
  })

  it("archives the open email when 'd' is pressed inside its HTML body", async () => {
    await vi.waitFor(() => expect(store.bodyLoadingId).toBe(null))
    store.messageBodies.set('today-1', {
      html: '<p><a href="https://example.com">Open link</a></p>',
      text: 'Open link',
    })
    await wrapper.vm.$nextTick()

    wrapper.findComponent(EmailBody).vm.$emit(
      'keydown',
      new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }),
    )

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
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

describe('TraditionalInboxView search results', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    routeMock.query = {}
    store = useInboxStore()
    // Relevance order (from the API) deliberately differs from date order:
    // the most relevant result is the oldest, the least relevant is newest.
    store.traditionalEmails = [
      makeEmail('rel-1', Date.now() - 10 * DAY),
      makeEmail('rel-2', Date.now() - HOUR),
    ]
    store.activeSearchQuery = 'invoice'
  })

  it('preserves the server relevance order instead of bucketing by date', () => {
    const wrapper = mount(TraditionalInboxView)

    // A single flat group, not the Today/Yesterday/Earlier date buckets.
    const headers = wrapper.findAll('.ni-group-header')
    expect(headers).toHaveLength(1)
    expect(headers[0].text()).not.toContain('Today')
    expect(headers[0].text()).not.toContain('Earlier')

    const subjects = wrapper.findAll('.ni-row .ni-subject').map((s) => s.text())
    expect(subjects[0]).toContain('Subject rel-1')
    expect(subjects[1]).toContain('Subject rel-2')
  })
})
