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

  it('shows each group email count in the header', () => {
    const wrapper = mount(TraditionalInboxView)

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').text()).toBe('1')
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
