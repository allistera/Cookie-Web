import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'

import TraditionalInboxView from '../TraditionalInboxView.vue'
import EmailBody from '../../components/EmailBody.vue'
import { useInboxStore } from '../../stores/inbox'
import { MESSAGES_API_URL } from '../../lib/apiWorkers'
import { scheduleChoices } from '../../utils/schedule'
import { setAuth0Client } from '../../auth0-client'

// The store's authHeaders sees no Auth0 client, matching stubbed-auth mode.
setAuth0Client(null)

// The view reads route.query.filter; tests that need a filter set it with
// `await router.replace({ path: '/inbox', query: {...} })` before mounting.
// `routerPush` spies on the real router's push so navigations don't resolve.
let router
let routerPush

// The signed-in account's address; reply-all leaves it out of the recipients.
const SELF_EMAIL = 'me@example.com'

function mountView(options = {}) {
  // useAuth0() is inject()-based, so providing under its key feeds the view a
  // signed-in user through the real interface.
  return mount(TraditionalInboxView, {
    ...options,
    global: {
      plugins: [router],
      provide: { [AUTH0_INJECTION_KEY]: { user: ref({ email: SELF_EMAIL }) } },
    },
  })
}

// View tests exercise optimistic store actions, but authentication and the
// network belong to the store's own unit suite. Give incidental background
// requests a deterministic success response; tests that care about a request
// replace this stub with a purpose-built mock.
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inbox', name: 'traditional-inbox', component: { template: '<div />' } },
      { path: '/calendar', name: 'calendar', component: { template: '<div />' } },
    ],
  })
  await router.push('/inbox')
  await router.isReady()
  routerPush = vi.spyOn(router, 'push').mockResolvedValue()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    store = useInboxStore()
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('yesterday-1', Date.now() - DAY),
      makeEmail('earlier-1', Date.now() - 10 * DAY),
    ]
  })

  function groupHeader(wrapper, label) {
    return wrapper.findAll('.ni-group-header').find((header) => header.text().includes(label))
  }

  it('shows only Today expanded by default', () => {
    const wrapper = mountView()

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
    const wrapper = mountView()

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

  it('offers to add a detected email event to the calendar', async () => {
    const eventEmail = makeEmail('event-offer', Date.now() - HOUR)
    eventEmail.sender = 'Campus Tours'
    eventEmail.subject = 'Confirmation: 2099-08-12 guided tour at 10:00 AM'
    eventEmail.snippet = 'Meet at the Visitor Center.'
    store.traditionalEmails.unshift(eventEmail)
    const wrapper = mountView()

    await wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('guided tour'))
      .trigger('click')

    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Event detected')
    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Add to calendar')
    await wrapper.get('.ni-calendar-suggestion-action').trigger('click')

    expect(store.calendarNewEventDraft).toMatchObject({
      title: '2099-08-12 guided tour at 10:00 AM',
      date: '2099-08-12',
      start: '10:00',
      end: '11:00',
    })
    expect(routerPush).toHaveBeenCalledWith({ name: 'calendar' })
  })

  it('detects calendar details after the full message body loads on demand', async () => {
    const eventEmail = makeEmail('event-body', Date.now() - HOUR)
    eventEmail.sender = 'Campus Tours'
    eventEmail.subject = 'Guided tour confirmation'
    eventEmail.snippet = 'Your booking is confirmed.'
    eventEmail.body = undefined
    store.traditionalEmails.unshift(eventEmail)
    const wrapper = mountView()

    await wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Guided tour'))
      .trigger('click')
    expect(wrapper.find('.ni-calendar-suggestion').exists()).toBe(false)

    store.messageBodies.set('event-body', {
      html: null,
      text: 'Meet at the Visitor Center for the August 12th 2099 tour at 10:00 AM.',
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Event detected')
  })

  it('uses a cached structured invite and keeps its 30-minute end time', async () => {
    // Tomorrow, not a fixed date: the suggestion is suppressed once the
    // invite has ended, so a hardcoded date turned into a time bomb.
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const inviteStart = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      15,
      0,
    )
    const inviteEnd = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      15,
      30,
    )
    const pad2 = (n) => String(n).padStart(2, '0')
    const inviteDate = `${inviteStart.getFullYear()}-${pad2(inviteStart.getMonth() + 1)}-${pad2(inviteStart.getDate())}`
    const eventEmail = makeEmail('event-invite', Date.now() - HOUR)
    eventEmail.subject = 'Booking confirmation'
    eventEmail.body = 'Your booking is confirmed.'
    store.traditionalEmails.unshift(eventEmail)
    const wrapper = mountView()

    await wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Booking confirmation'))
      .trigger('click')

    // Let the open-reader fetch settle before supplying the cached API result.
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.messageBodies.set('event-invite', {
      html: null,
      text: 'Your booking is confirmed.',
      calendarInvite: {
        title: 'Whitburn Recycling Centre',
        description: 'Booking 1292383',
        location: 'Whitburn Recycling Centre',
        start_at: inviteStart.toISOString(),
        end_at: inviteEnd.toISOString(),
      },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Event detected')
    await wrapper.get('.ni-calendar-suggestion-action').trigger('click')
    expect(store.calendarNewEventDraft).toMatchObject({
      title: 'Whitburn Recycling Centre',
      description: 'Booking 1292383',
      location: 'Whitburn Recycling Centre',
      date: inviteDate,
      start: '15:00',
      end: '15:30',
    })
  })

  it('shows due scheduled emails in an expanded Due Today group above Today', () => {
    const due = makeEmail('due-1', Date.now() - 5 * DAY)
    due.scheduledFor = new Date(Date.now() - HOUR).toISOString()
    store.traditionalEmails.unshift(due)

    const wrapper = mountView()
    const headers = wrapper.findAll('.ni-group-header').map((header) => header.text())

    expect(headers[0]).toContain('Due Today')
    expect(headers[1]).toContain('Today')
    expect(groupHeader(wrapper, 'Due Today').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.ni-row')[0].text()).toContain('Subject due-1')
  })

  it('shows due sent follow-ups in Due Today with a visible reminder badge', () => {
    const followUp = makeEmail('follow-up-1', Date.now() - 5 * DAY)
    followUp.isSent = true
    followUp.unread = false
    followUp.followUpAt = new Date(Date.now() - HOUR).toISOString()
    store.traditionalEmails.unshift(followUp)

    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Due Today').attributes('aria-expanded')).toBe('true')
    const row = wrapper
      .findAll('.ni-row')
      .find((item) => item.text().includes('Subject follow-up-1'))
    expect(row.get('.ni-follow-up-status').text()).toContain('Follow up')
  })

  it('does not render Due Today when no scheduled emails are due', () => {
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Due Today')).toBeUndefined()
  })

  it('expands a closed group on header click', async () => {
    const wrapper = mountView()

    await groupHeader(wrapper, 'Yesterday').trigger('click')

    const rows = wrapper.findAll('.ni-row').map((r) => r.text())
    expect(rows).toHaveLength(2)
    expect(rows.some((text) => text.includes('Subject yesterday-1'))).toBe(true)
  })

  it('collapses Today on header click', async () => {
    const wrapper = mountView()

    await groupHeader(wrapper, 'Today').trigger('click')

    expect(wrapper.findAll('.ni-row')).toHaveLength(0)
    expect(groupHeader(wrapper, 'Today').attributes('aria-expanded')).toBe('false')
  })

  it('shows the unread count in a group header', () => {
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').text()).toBe('1')
  })

  it('counts only unread emails, not the group total', () => {
    store.traditionalEmails = [
      { ...makeEmail('y-unread', Date.now() - DAY), unread: true },
      { ...makeEmail('y-read', Date.now() - DAY), unread: false },
    ]
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').text()).toBe('1')
  })

  it('hides the count badge when a group has no unread emails', () => {
    store.traditionalEmails = [{ ...makeEmail('y-read', Date.now() - DAY), unread: false }]
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').exists()).toBe(false)
  })
})

describe('TraditionalInboxView group Mark Read tooltip', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
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
    const wrapper = mountView()

    const markRead = header(wrapper, 'Yesterday').find('.ni-group-mark-read')
    expect(markRead.exists()).toBe(true)
    expect(markRead.text()).toContain('Mark Read')
    expect(markRead.attributes('role')).toBe('button')
  })

  it('clicking Mark Read marks every unread email of that day as read', async () => {
    const wrapper = mountView()

    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')

    expect(store.traditionalEmails.every((e) => !e.unread)).toBe(true)
    expect(store.unreadInboxCount).toBe(0)
    // The badge (and with it the tooltip) disappears once nothing is unread.
    await wrapper.vm.$nextTick()
    expect(header(wrapper, 'Yesterday').find('.ni-group-count').exists()).toBe(false)
  })

  it('clicking Mark Read does not toggle the group accordion', async () => {
    const wrapper = mountView()

    expect(header(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')
    expect(header(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
  })

  it('only touches emails of its own day group', async () => {
    store.traditionalEmails.push({ ...makeEmail('today-unread', Date.now() - HOUR), unread: true })
    store.unreadInboxCount = 3
    const wrapper = mountView()

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
    store = useInboxStore()
    const starred = makeEmail('starred-1', Date.now() - HOUR)
    starred.starred = true
    const labeled = makeEmail('labeled-1', Date.now() - HOUR)
    labeled.labels = [{ name: 'Home', color: '#ff0000' }]
    store.traditionalEmails = [makeEmail('plain-1', Date.now() - HOUR), starred, labeled]
    store.starredEmails = [starred]
    store.labelEmails = [labeled]
    vi.spyOn(store, 'loadStarredEmails').mockResolvedValue()
    vi.spyOn(store, 'loadLabelEmails').mockResolvedValue()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('filter=starred shows only starred emails with a Starred header', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    const wrapper = mountView()

    expect(wrapper.find('.ni-header h1').text()).toBe('Starred')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject starred-1')
  })

  it('hides starred emails from the inbox', () => {
    const wrapper = mountView()

    const rows = wrapper.findAll('.ni-row').map((row) => row.text())
    expect(rows).toHaveLength(2)
    expect(rows.some((text) => text.includes('Subject starred-1'))).toBe(false)
  })

  it('moves an email from the inbox to the Starred folder as soon as it is starred', async () => {
    store.isStarredLoaded = true
    let wrapper = mountView()

    await wrapper.find('.ni-row [title="Star"]').trigger('click')

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).not.toContain(
      expect.stringContaining('Subject plain-1'),
    )
    expect(store.starredEmails.some((email) => email.id === 'plain-1')).toBe(true)

    wrapper.unmount()
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    wrapper = mountView()

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject plain-1'),
    )
  })

  it('keeps starred matches visible in search results', () => {
    store.activeSearchQuery = 'starred'

    const wrapper = mountView()

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject starred-1'),
    )
  })

  it('closes the reader when its email is starred from outside the row', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    store.toggleStar(store.openEmail)
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })

  it('filter=label shows only emails carrying that label', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'label', label: 'Home' } })
    const wrapper = mountView()

    expect(wrapper.find('.ni-header h1').text()).toBe('Home')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject labeled-1')
  })

  it('loads more from the Starred and label folders', async () => {
    store.hasMoreStarred = true
    vi.spyOn(store, 'loadMoreStarredEmails').mockResolvedValue()
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    let wrapper = mountView()
    await wrapper.find('.ni-load-more').trigger('click')
    expect(store.loadMoreStarredEmails).toHaveBeenCalledTimes(1)
    wrapper.unmount()

    store.hasMoreLabel = true
    vi.spyOn(store, 'loadMoreLabelEmails').mockResolvedValue()
    await router.replace({ path: '/inbox', query: { filter: 'label', label: 'Home' } })
    wrapper = mountView()
    await wrapper.find('.ni-load-more').trigger('click')
    expect(store.loadMoreLabelEmails).toHaveBeenCalledTimes(1)
  })

  it('filter=snoozed groups future emails by snooze target with both groups open', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'snoozed' } })
    const choices = scheduleChoices()
    const tomorrow = choices.find(({ id }) => id === 'tomorrow')
    const nextWeek = choices.find(({ id }) => id === 'next-week')
    const tomorrowEmail = makeEmail('tomorrow-1', Date.now() - 10 * DAY)
    tomorrowEmail.scheduledFor = tomorrow.date.toISOString()
    const nextWeekEmail = makeEmail('next-week-1', Date.now() - HOUR)
    nextWeekEmail.scheduledFor = nextWeek.date.toISOString()
    store.snoozedEmails = [nextWeekEmail, tomorrowEmail]
    vi.spyOn(store, 'loadSnoozedEmails').mockResolvedValue()
    const wrapper = mountView()

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
    await router.replace({ path: '/inbox', query: { filter: 'done' } })
    store.doneEmails = [makeEmail('done-1', Date.now() - HOUR)]
    vi.spyOn(store, 'loadDonePage').mockResolvedValue()
    const wrapper = mountView()

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

  it('shows opened status in sent rows and the reader', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'sent' } })
    const sent = makeEmail('sent-opened', Date.now() - HOUR)
    sent.isSent = true
    sent.to = 'reader@example.com'
    sent.unread = false
    sent.readAt = '2026-07-14T10:30:00.000Z'
    store.sentEmails = [sent]
    vi.spyOn(store, 'loadSentEmails').mockResolvedValue()

    const wrapper = mountView()

    const rowStatus = wrapper.get('.ni-row .ni-read-status')
    expect(rowStatus.text()).toContain('Opened')
    expect(rowStatus.attributes('title')).toContain('Opened 14 Jul')

    await wrapper.get('.ni-row').trigger('click')
    expect(wrapper.get('.ni-reader .ni-read-status').text()).toContain('Opened 14 Jul')
  })

  it('sets and clears a follow-up reminder from the sent-message reader', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'sent' } })
    const sent = makeEmail('sent-reminder', Date.now() - HOUR)
    sent.isSent = true
    sent.to = 'reader@example.com'
    sent.unread = false
    store.sentEmails = [sent]
    vi.spyOn(store, 'loadSentEmails').mockResolvedValue()
    const setFollowUp = vi
      .spyOn(store, 'setMessageFollowUp')
      .mockImplementation(async (email, followUpAt) => {
        email.followUpAt = followUpAt
        return { id: email.id, followUpAt }
      })

    const wrapper = mountView()
    await wrapper.get('.ni-row').trigger('click')
    await wrapper.get('.ni-reader-topbar [title="Remind me if no reply"]').trigger('click')
    const tomorrow = wrapper
      .findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Tomorrow'))
    await tomorrow.trigger('click')

    expect(setFollowUp).toHaveBeenCalledWith(sent, expect.any(String))
    await wrapper.get('.ni-reader-topbar [title^="Follow-up reminder:"]').trigger('click')
    const clear = wrapper
      .findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Clear reminder'))
    await clear.trigger('click')

    expect(setFollowUp).toHaveBeenLastCalledWith(sent, null)
  })

  it('an unknown filter falls back to the unstarred inbox', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'bogus' } })
    const wrapper = mountView()

    expect(wrapper.find('.ni-header h1').text()).toBe('Inbox')
    expect(wrapper.findAll('.ni-row')).toHaveLength(2)
  })
})

describe('TraditionalInboxView AI summary marker across email lists', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    vi.spyOn(store, 'loadSentEmails').mockResolvedValue()
    vi.spyOn(store, 'loadSpamEmails').mockResolvedValue()
    vi.spyOn(store, 'loadSnoozedEmails').mockResolvedValue()
    vi.spyOn(store, 'loadStarredEmails').mockResolvedValue()
    vi.spyOn(store, 'loadLabelEmails').mockResolvedValue()
    vi.spyOn(store, 'loadDonePage').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['Inbox', {}, 'traditionalEmails'],
    ['Starred', { filter: 'starred' }, 'starredEmails'],
    ['Label', { filter: 'label', label: 'Projects' }, 'labelEmails'],
    ['Sent', { filter: 'sent' }, 'sentEmails'],
    ['Spam', { filter: 'spam' }, 'spamEmails'],
    ['Snoozed', { filter: 'snoozed' }, 'snoozedEmails'],
    ['Done', { filter: 'done' }, 'doneEmails'],
    ['Search', {}, 'traditionalEmails'],
  ])('shows the AI icon in the %s list', async (_name, query, listName) => {
    await router.replace({ path: '/inbox', query })
    const email = makeEmail(`summary-${listName}`, Date.now() - HOUR)
    email.hasAiSummary = true
    if (query.filter === 'starred') email.starred = true
    if (query.filter === 'label') email.labels = [{ name: 'Projects', color: '#7c3aed' }]
    if (query.filter === 'snoozed') email.scheduledFor = new Date(Date.now() + DAY).toISOString()
    store[listName] = [email]
    if (_name === 'Search') store.activeSearchQuery = 'summary'

    const wrapper = mountView()

    expect(wrapper.find('.ni-row .ni-ai-generated-icon').text()).toBe('auto_awesome')
    wrapper.unmount()
  })
})

describe('TraditionalInboxView reading panel', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
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
    const wrapper = mountView()

    await wrapper.find('.ni-row').trigger('click')
    expect(store.openEmailId).toBe('today-1')
    expect(wrapper.find('.ni-reader').exists()).toBe(true)
  })

  it('closes the reader when the open email is archived from outside the view', async () => {
    const wrapper = mountView()

    await wrapper.find('.ni-row').trigger('click')
    store.archiveEmail(store.openEmail)
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })
})

describe('TraditionalInboxView reply send button', () => {
  let store
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function openReplyBox() {
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
    await wrapper.find('.ni-reader-footer .ni-pill-btn').trigger('click')
    // The reply body is the shared rich compose editor (contenteditable), not
    // a textarea — set content and fire input like a user typing.
    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.innerHTML = 'Sounds good!'
    await editor.trigger('input')
    return wrapper.find('.ni-reply-footer .btn-primary')
  }

  it('disables the Send button while the reply is in flight', async () => {
    let resolveSend
    vi.spyOn(store, 'sendMail').mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve
      }),
    )
    const sendButton = await openReplyBox()
    expect(sendButton.attributes()).not.toHaveProperty('disabled')

    await sendButton.trigger('click')

    expect(sendButton.attributes()).toHaveProperty('disabled')
    expect(sendButton.attributes('aria-busy')).toBe('true')
    expect(sendButton.text()).toContain('Sending…')

    resolveSend()
    await vi.waitFor(() => expect(wrapper.find('.ni-reply-box').exists()).toBe(false))
  })

  it('sends only once when Send is clicked twice in quick succession', async () => {
    vi.spyOn(store, 'sendMail').mockReturnValue(new Promise(() => {}))
    const sendButton = await openReplyBox()

    await sendButton.trigger('click')
    await sendButton.trigger('click')

    expect(store.sendMail).toHaveBeenCalledTimes(1)
  })

  it('re-enables the Send button after a failed send so the user can retry', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(store, 'sendMail').mockRejectedValue(new Error('boom'))
    const sendButton = await openReplyBox()

    await sendButton.trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((toast) => toast.kind === 'error')).toBe(true)
    })

    expect(sendButton.attributes()).not.toHaveProperty('disabled')
    expect(sendButton.text()).toContain('Send')
    expect(wrapper.find('.ni-reply-box').exists()).toBe(true)
    expect(consoleError).toHaveBeenCalledWith('Failed to send reply:', expect.any(Error))
  })

  it('inserts a picked emoji as an emoticon in the reply body', async () => {
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const sendButton = await openReplyBox()

    await wrapper.get('.ni-reply-footer .composer-emoji-btn').trigger('click')
    await wrapper.get('.composer-emoji-item[aria-label="thumbs up"]').trigger('click')

    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toContain('+1')

    await sendButton.trigger('click')
    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('+1'),
        html: expect.stringContaining('+1'),
      }),
    )
  })

  it('sends the reply as sanitized html alongside its plain text', async () => {
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const sendButton = await openReplyBox()

    await sendButton.trigger('click')

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sender-today-1@example.com',
        text: 'Sounds good!',
        html: expect.stringContaining('Sounds good!'),
      }),
    )
  })

  function seedGroupEmail() {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: {
          to: [
            { name: 'Me', address: SELF_EMAIL },
            { name: 'Bea', address: 'bea@example.com' },
          ],
          cc: [
            { name: null, address: 'cara@example.com' },
            // Same person as the sender, differing only in case.
            { name: null, address: 'Sender-Today-1@example.com' },
          ],
        },
      },
    ]
  }

  it('replies to everyone except the signed-in account from the reply-all icon', async () => {
    seedGroupEmail()
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.get('.ni-reader [title="Reply all"]').trigger('click')
    expect(wrapper.get('.ni-reply-header span:last-child').text()).toBe(
      'Reply all to Sender today-1, Bea, cara@example.com',
    )
    expect(wrapper.get('.ni-reply-header .material-symbols-outlined').text()).toBe('reply_all')

    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.innerHTML = 'Sounds good!'
    await editor.trigger('input')
    await wrapper.find('.ni-reply-footer .btn-primary').trigger('click')

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sender-today-1@example.com, bea@example.com, cara@example.com',
        subject: 'Re: Subject today-1',
        replyToMessageId: 'today-1',
      }),
    )
  })

  it('switching between Reply and Reply all keeps the draft and changes only the recipients', async () => {
    seedGroupEmail()
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.get('.ni-reader [title="Reply all"]').trigger('click')
    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.innerHTML = 'Sounds good!'
    await editor.trigger('input')

    await wrapper.get('.ni-reader [title="Reply"]').trigger('click')
    expect(wrapper.get('.ni-reply-header span:last-child').text()).toBe('Reply to Sender today-1')
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toContain('Sounds good!')

    await wrapper.find('.ni-reply-footer .btn-primary').trigger('click')
    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sender-today-1@example.com' }),
    )
  })

  it('hides Reply all when the message went to a single contact', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: { to: [{ name: null, address: SELF_EMAIL }], cc: [] },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply"]').exists()).toBe(true)
    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(false)
  })

  it('shows Reply all for a message sent to someone else, such as a list', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: { to: [{ name: null, address: 'team@example.com' }], cc: [] },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(true)
  })

  it('shows Reply all when the second contact is only on the Cc line', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: {
          to: [{ name: null, address: SELF_EMAIL }],
          cc: [{ name: null, address: 'cara@example.com' }],
        },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(true)
  })

  it('hides Reply all when the only other addresses are the sender and the signed-in account', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: {
          to: [{ name: null, address: SELF_EMAIL }],
          cc: [
            { name: 'Me', address: SELF_EMAIL.toUpperCase() },
            { name: null, address: 'Sender-Today-1@example.com' },
          ],
        },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(false)
  })

  it('carries the reply-all recipients into the composer for an AI draft', async () => {
    seedGroupEmail()
    vi.spyOn(store, 'openComposer').mockImplementation(() => {})
    vi.spyOn(store, 'openAiDraft').mockImplementation(() => {})
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.get('.ni-reader [title="Reply all"]').trigger('click')
    wrapper.findComponent({ name: 'ComposerEditor' }).vm.$emit('generate')
    await nextTick()

    expect(store.composerTo).toBe('sender-today-1@example.com, bea@example.com, cara@example.com')
    expect(store.composerReplyToMessageId).toBe('today-1')
    expect(store.openComposer).toHaveBeenCalled()
  })

  it('sends the selected follow-up reminder with an inline reply', async () => {
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const sendButton = await openReplyBox()

    await wrapper.get('.ni-follow-up-btn').trigger('click')
    const tomorrow = wrapper
      .findAll('.ni-reply-footer .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Tomorrow'))
    await tomorrow.trigger('click')
    await sendButton.trigger('click')

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        followUpAt: expect.any(String),
      }),
    )
  })

  it('offers slash commands, including saved snippets, in the reply editor', async () => {
    store.snippets = [{ id: 's1', name: 'thanks', html: '<p>Thanks!</p>' }]
    wrapper = mountView({ attachTo: document.body })
    await wrapper.find('.ni-row').trigger('click')
    await wrapper.find('.ni-reader-footer .ni-pill-btn').trigger('click')

    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.textContent = '/'
    editor.element.focus()
    const range = document.createRange()
    range.setStart(editor.element.firstChild, 1)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    await editor.trigger('input')

    const menu = wrapper.find('.ni-reply-box .composer-slash-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('thanks')
    expect(menu.text()).toContain('Generate Message')
    expect(menu.text()).toContain('Bullet list')
  })
})

describe('TraditionalInboxView multi-select', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
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
    const wrapper = mountView()

    await checkbox(wrapper, 0).trigger('click')

    expect(checkbox(wrapper, 0).attributes('aria-checked')).toBe('true')
    expect(checkbox(wrapper, 0).text()).toContain('check_box')
    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-bulk-bar').text()).toContain('1 selected')
  })

  it('selecting several shows the count and the three bulk pills', async () => {
    const wrapper = mountView()

    await checkbox(wrapper, 0).trigger('click')
    await checkbox(wrapper, 1).trigger('click')

    const bar = wrapper.find('.ni-bulk-bar')
    expect(bar.text()).toContain('2 selected')
    const pills = bar.findAll('.ni-bulk-pill').map((p) => p.text())
    expect(pills.some((t) => t.includes('Star'))).toBe(true)
    expect(pills.some((t) => t.includes('Done'))).toBe(true)
    expect(pills.some((t) => t.includes('Reschedule'))).toBe(true)
  })

  it('the bulk Reschedule pill offers richer presets and a custom picker', async () => {
    const wrapper = mountView()
    await checkbox(wrapper, 0).trigger('click')

    await wrapper
      .findAll('.ni-bulk-pill')
      .find((pill) => pill.text().includes('Reschedule'))
      .trigger('click')

    const choices = wrapper.findAll('.ni-schedule-menu [role="menuitem"]')
    expect(choices.map((choice) => choice.text())).toEqual([
      expect.stringContaining('Later today'),
      expect.stringContaining('Tomorrow'),
      expect.stringContaining('This weekend'),
      expect.stringContaining('Next Week'),
      expect.stringContaining('Pick date & time'),
    ])
  })

  it('the Done pill archives every selected email and hides the bar', async () => {
    vi.spyOn(useInboxStore(), 'archiveEmail')
    const wrapper = mountView()

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
    const wrapper = mountView()

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
    const wrapper = mountView()
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
    const wrapper = mountView()
    const row = wrapper.find('.ni-row')

    const done = row.find('[title="Done"]')
    expect(done.exists()).toBe(true)
    expect(done.text()).toContain('check_box')
    expect(row.find('[title="Delete"]').exists()).toBe(false)
    expect(row.find('[title="Archive"]').exists()).toBe(false)
  })

  it('clicking Done archives the email', async () => {
    vi.spyOn(useInboxStore(), 'archiveEmail')
    const wrapper = mountView()

    await wrapper.find('.ni-row [title="Done"]').trigger('click')

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
  })

  it('welcomes the user to Inbox Zero after the last email is marked Done', async () => {
    const wrapper = mountView()

    expect(wrapper.find('.ni-inbox-zero').exists()).toBe(false)
    await wrapper.find('.ni-row [title="Done"]').trigger('click')

    const inboxZero = wrapper.find('.ni-inbox-zero')
    expect(inboxZero.attributes('role')).toBe('status')
    expect(inboxZero.text()).toContain('Welcome to Inbox Zero')
    expect(inboxZero.find('.ni-inbox-zero-icon').text()).toBe('task_alt')
  })

  it('the reader topbar offers Star, Done and Reschedule with no Delete or Archive', async () => {
    const wrapper = mountView()
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
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Star"]').trigger('click')

    expect(store.toggleStar).toHaveBeenCalledTimes(1)
    expect(store.toggleStar.mock.calls[0][0].id).toBe('today-1')
  })

  it('the reader Reschedule action schedules the email for Tomorrow', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Reschedule"]').trigger('click')
    const choices = wrapper.findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
    expect(choices.map((choice) => choice.text())).toEqual([
      expect.stringContaining('Later today'),
      expect.stringContaining('Tomorrow'),
      expect.stringContaining('This weekend'),
      expect.stringContaining('Next Week'),
      expect.stringContaining('Pick date & time'),
    ])
    await choices[1].trigger('click')

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

  it('the reader custom picker schedules the selected local date and time', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Reschedule"]').trigger('click')
    const custom = wrapper
      .findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Pick date & time'))
    await custom.trigger('click')
    const target = new Date(Date.now() + 3 * DAY)
    target.setHours(14, 30, 0, 0)
    const pad = (n) => String(n).padStart(2, '0')
    const localValue = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T14:30`
    await wrapper.find('.ni-schedule-custom input').setValue(localValue)
    await wrapper.find('.ni-schedule-custom').trigger('submit')

    await vi.waitFor(() => {
      const patchRequest = fetch.mock.calls.find(([, options]) => {
        if (options?.method !== 'PATCH') return false
        return Object.hasOwn(JSON.parse(options.body), 'scheduled_for')
      })
      expect(JSON.parse(patchRequest[1].body)).toMatchObject({
        id: 'today-1',
        scheduled_for: target.toISOString(),
      })
    })
  })
})

describe('TraditionalInboxView AI summary', () => {
  let store
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
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
    wrapper = mountView()
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
    wrapper = mountView()

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
    const wrapper = mountView()

    expect(wrapper.find('.ni-row [title="Snooze"]').exists()).toBe(false)
  })

  it('the reader keeps placeholder controls hidden and offers Forward beside Reply', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const reader = wrapper.find('.ni-reader')
    expect(reader.find('[title="Snooze"]').exists()).toBe(false)
    expect(reader.find('[title="More"]').exists()).toBe(false)
    expect(reader.find('[title="Forward"]').exists()).toBe(true)

    const pills = reader.findAll('.ni-reader-footer .ni-pill-btn')
    expect(pills).toHaveLength(2)
    expect(pills[0].text()).toContain('Reply')
    expect(pills[1].text()).toContain('Forward')
  })

  it('opens a forward draft with a quoted body and downloadable attachments', async () => {
    const email = store.traditionalEmails[0]
    store.messageBodies.set(email.id, {
      html: '<p>Original <strong>message</strong></p><script>alert(1)</script>',
      text: 'Original message',
      attachments: [
        {
          id: 'att-1',
          filename: 'plan.pdf',
          content_type: 'application/pdf',
          size_bytes: 2048,
          downloadable: true,
        },
        {
          id: 'legacy-att',
          filename: 'legacy.txt',
          downloadable: false,
        },
      ],
    })
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const forward = wrapper
      .findAll('.ni-reader-footer .ni-pill-btn')
      .find((button) => button.text().includes('Forward'))
    await forward.trigger('click')

    expect(store.isComposerActive).toBe(true)
    expect(store.composerTo).toBe('')
    expect(store.composerSubject).toBe(`Fwd: ${email.subject}`)
    expect(store.composerTextArea).toContain('---------- Forwarded message ----------')
    expect(store.composerTextArea).toContain('> Original message')
    expect(store.composerHtml).toContain('<blockquote><p>Original <strong>message</strong></p>')
    expect(store.composerHtml).not.toContain('<script')
    expect(store.composerAttachments).toEqual([
      expect.objectContaining({ id: 'att-1', filename: 'plan.pdf' }),
    ])
  })

  it('does not replace an existing draft or create a truncated forward', async () => {
    const email = store.traditionalEmails[0]
    store.messageBodies.set(email.id, { html: null, text: 'Original', attachments: [] })
    store.isComposerActive = true
    store.composerHtml = '<p>My draft</p>'
    const notify = vi.spyOn(store, 'notify')
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
    const forward = wrapper
      .findAll('.ni-reader-footer .ni-pill-btn')
      .find((button) => button.text().includes('Forward'))

    await forward.trigger('click')

    expect(store.composerHtml).toBe('<p>My draft</p>')
    expect(notify).toHaveBeenCalledWith('Close your current draft before forwarding.', 'error')

    store.closeComposer()
    store.messageBodies.delete(email.id)
    vi.spyOn(store, 'fetchMessageBody').mockResolvedValue(null)
    await forward.trigger('click')

    expect(store.isComposerActive).toBe(false)
    expect(notify).toHaveBeenCalledWith('Could not load the original email to forward.', 'error')
  })

  it('keeps the working reader controls', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const reader = wrapper.find('.ni-reader')
    expect(reader.find('[title="Reply"]').exists()).toBe(true)
    // Reply all only appears for messages with more than one contact.
    expect(reader.find('[title="Reply all"]').exists()).toBe(false)
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
    wrapper = mountView()
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
    wrapper = mountView()
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
      ([requestUrl, options]) =>
        requestUrl === `${MESSAGES_API_URL}/messages` && options.method === 'POST',
    )
    expect(url).toBe(`${MESSAGES_API_URL}/messages`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      id: 'news-1',
      action: 'unsubscribe',
      allow_ai: true,
    })

    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })

  it('opens the unsubscribe page when the sender only offers a link', async () => {
    const reader = await openReader({
      oneClick: false,
      url: 'https://news.example/unsub',
      mailto: null,
    })
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
    // Only a confirmed unsubscribe marks the email done — the manual page may
    // still be abandoned, so the email stays in the inbox.
    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(true)
    expect(store.openEmailId).toBe('news-1')
  })

  it('disables the button and shows a spinner while the unsubscribe is in flight', async () => {
    const reader = await openReader({
      oneClick: false,
      url: 'https://news.example/unsub',
      mailto: null,
    })
    let resolveRequest
    fetchMock.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)))

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.unsubscribingId).toBe('news-1')
    })
    await wrapper.vm.$nextTick()

    const button = reader.find('[title="Unsubscribe"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.find('.ni-unsub-spinner').exists()).toBe(true)
    expect(button.text()).toContain('Unsubscribing')

    resolveRequest({ ok: true, json: async () => ({ status: 'unsubscribed', method: 'ai' }) })
    await vi.waitFor(() => {
      expect(store.unsubscribingId).toBe(null)
    })
  })

  it('replaces the button with a disabled failed state when the AI attempt fails', async () => {
    const reader = await openReader({
      oneClick: false,
      url: 'https://news.example/unsub',
      mailto: null,
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ai_failed', method: 'ai', url: 'https://news.example/unsub' }),
    })

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.message.includes('AI could not unsubscribe'))).toBe(true)
    })
    await wrapper.vm.$nextTick()

    const button = reader.find('[title="Unsubscribe"]')
    expect(button.text()).toContain('AI Unsubscribe Failed')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.classes()).toContain('failed')
    // The email is not marked done on failure.
    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(true)
  })

  it('surfaces an error toast when the unsubscribe request fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reader = await openReader(UNSUB)
    fetchMock.mockImplementation(async (_url, options = {}) => ({
      ok: options.method !== 'POST',
      status: options.method === 'POST' ? 502 : 200,
      json: async () => ({}),
    }))

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.kind === 'error')).toBe(true)
    })
    expect(consoleError).toHaveBeenCalledWith('Unsubscribe failed:', expect.any(Error))
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
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.spyOn(store, 'archiveEmail')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
    wrapper = mountView()
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

    wrapper
      .findComponent(EmailBody)
      .vm.$emit(
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

  it('expands the date group when auto-advance crosses into another day', async () => {
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('yesterday-1', Date.now() - DAY),
    ]
    await wrapper.vm.$nextTick()

    const yesterdayHeader = wrapper
      .findAll('.ni-group-header')
      .find((header) => header.text().includes('Yesterday'))
    expect(yesterdayHeader.attributes('aria-expanded')).toBe('false')
    await wrapper.find('.ni-row').trigger('click')

    pressD()
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe('yesterday-1')
    expect(yesterdayHeader.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject yesterday-1'),
    )
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
    const wrapper = mountView()

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

// The AI Inbox's triage rows link to /inbox?open=<id>, so the view has to open
// that specific email rather than just landing on the list.
describe('opening an email from the route', () => {
  // This file shares one pinia across its tests, so the reader state has to be
  // cleared rather than assumed empty.
  function resetReader() {
    const store = useInboxStore()
    store.openEmailId = null
    store.traditionalEmails = []
    return store
  }

  it('opens the email named by ?open', async () => {
    const store = resetReader()
    store.traditionalEmails = [
      { id: 'm1', subject: 'First', sender: 'A', unread: true },
      { id: 'm2', subject: 'Second', sender: 'B', unread: true },
    ]
    await router.replace({ path: '/inbox', query: { open: 'm2' } })

    mountView()
    await nextTick()

    expect(store.openEmailId).toBe('m2')
  })

  it('leaves the reader closed when no ?open is given', async () => {
    const store = resetReader()
    store.traditionalEmails = [{ id: 'm1', subject: 'First', sender: 'A', unread: true }]
    await router.replace({ path: '/inbox' })

    mountView()
    await nextTick()

    expect(store.openEmailId).toBeNull()
  })

  // The list is usually still in flight when the route lands, so the view must
  // wait for the email to arrive rather than give up on the first miss.
  it('opens the email once the list finishes loading', async () => {
    const store = resetReader()
    await router.replace({ path: '/inbox', query: { open: 'm2' } })

    mountView()
    await nextTick()
    expect(store.openEmailId).toBeNull()

    store.traditionalEmails = [{ id: 'm2', subject: 'Second', sender: 'B', unread: true }]
    await nextTick()

    expect(store.openEmailId).toBe('m2')
  })

  it('marks the opened email read', async () => {
    const store = resetReader()
    store.traditionalEmails = [{ id: 'm2', subject: 'Second', sender: 'B', unread: true }]
    await router.replace({ path: '/inbox', query: { open: 'm2' } })

    mountView()
    await nextTick()

    expect(store.traditionalEmails[0].unread).toBe(false)
  })
})
