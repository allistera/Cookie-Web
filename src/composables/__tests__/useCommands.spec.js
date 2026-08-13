import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'

import { useCommands } from '../useCommands'
import { useInboxStore } from '../../stores/inbox'
import { setAuth0Client } from '../../auth0-client'

// useCommands needs a component's injection context for useRoute/useRouter,
// so run it inside a bare harness mounted with a real memory-history router.
async function setupCommands(routeName = 'ai-inbox') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'ai-inbox', component: { template: '<div />' } },
      { path: '/inbox', name: 'traditional-inbox', component: { template: '<div />' } },
      { path: '/calendar', name: 'calendar', component: { template: '<div />' } },
      { path: '/scheduled', name: 'scheduled-sends', component: { template: '<div />' } },
    ],
  })
  await router.push({ name: routeName })
  await router.isReady()
  const push = vi.spyOn(router, 'push').mockResolvedValue()

  let commands
  let filterCommands
  const Harness = defineComponent({
    setup() {
      ;({ commands, filterCommands } = useCommands())
      return () => null
    },
  })
  mount(Harness, { global: { plugins: [router] } })

  return { commands, filterCommands, push }
}

function makeEmail(overrides = {}) {
  return {
    id: 'abc-123',
    sender: 'Sender',
    subject: 'Subject',
    unread: true,
    starred: false,
    labels: [],
    ...overrides,
  }
}

describe('useCommands', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    setAuth0Client({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') })
    store = useInboxStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides email commands when no email is open', async () => {
    const { commands } = await setupCommands()

    const ids = commands.value.map((c) => c.id)
    expect(ids).not.toContain('mark-done')
    expect(ids).not.toContain('star')
    expect(ids).toContain('go-inbox')
    expect(ids).toContain('open-settings')
  })

  it('only offers Create Event while on the Calendar route, and it requests one from the store', async () => {
    const aiInbox = await setupCommands()
    expect(aiInbox.commands.value.map((c) => c.id)).not.toContain('calendar-create-event')

    const { commands } = await setupCommands('calendar')
    const createEvent = commands.value.find((c) => c.id === 'calendar-create-event')
    expect(createEvent).toBeTruthy()
    expect(createEvent.title).toBe('Create Event')

    expect(store.calendarNewEventRequestId).toBe(0)
    createEvent.run()
    expect(store.calendarNewEventRequestId).toBe(1)
  })

  it('always offers a Compose command that opens the composer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }))
    const { commands } = await setupCommands()

    const compose = commands.value.find((c) => c.id === 'compose')
    expect(compose).toBeTruthy()
    expect(compose.title).toBe('Compose')

    compose.run()
    expect(store.isComposerActive).toBe(true)
  })

  it('shows email commands when an email is open, with state-aware titles', async () => {
    const email = makeEmail({ starred: true, unread: false })
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    const { commands } = await setupCommands()
    const byId = Object.fromEntries(commands.value.map((c) => [c.id, c]))

    expect(byId['mark-done'].keyHint).toBe('E')
    expect(byId['star'].title).toBe('Unstar')
    expect(byId['toggle-read'].title).toBe('Mark Unread')
    expect(byId['snooze'].comingSoon).toBe(true)
    expect(byId['move'].comingSoon).toBe(true)
    expect(byId['label'].comingSoon).toBe(true)
  })

  it('creates one navigation command per label', async () => {
    // allLabels reads the full label palette (store.labels), not email labels.
    store.labels = [
      { id: 'l1', name: 'Home', color: '#f00', kind: 'user' },
      { id: 'l2', name: 'Work', color: '#0f0', kind: 'user' },
    ]

    const { commands, push } = await setupCommands()
    const labelCmds = commands.value.filter((c) => c.id.startsWith('go-label-'))
    expect(labelCmds.map((c) => c.title)).toEqual(['Go to label Home', 'Go to label Work'])

    labelCmds[0].run()
    expect(push).toHaveBeenCalledWith({
      path: '/inbox',
      query: { filter: 'label', label: 'Home' },
    })
  })

  it('navigation commands push the filter routes', async () => {
    const { commands, push } = await setupCommands()
    const byId = Object.fromEntries(commands.value.map((c) => [c.id, c]))

    byId['go-starred'].run()
    expect(push).toHaveBeenCalledWith({ path: '/inbox', query: { filter: 'starred' } })

    byId['go-done'].run()
    expect(push).toHaveBeenCalledWith({ path: '/inbox', query: { filter: 'done' } })

    byId['go-scheduled'].run()
    expect(push).toHaveBeenCalledWith({ path: '/scheduled' })

    byId['go-spam'].run()
    expect(push).toHaveBeenCalledWith({ path: '/inbox', query: { filter: 'spam' } })

    byId['open-settings'].run()
    expect(store.activeModal).toBe('settings')
  })

  it('mark-done archives the open email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
    const email = makeEmail()
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    const { commands } = await setupCommands()
    commands.value.find((c) => c.id === 'mark-done').run()

    expect(store.traditionalEmails).toHaveLength(0)
    expect(store.openEmailId).toBe(null)
    expect(store.toasts.some((t) => t.message === 'Marked done.')).toBe(true)
  })

  describe('filterCommands', () => {
    it('ranks substring matches above subsequence matches and drops non-matches', async () => {
      const { filterCommands } = await setupCommands()
      const list = [
        { title: 'Go to Starred' },
        { title: 'Star' },
        { title: 'Mark Done' },
        { title: 'Snooze' },
      ]

      const results = filterCommands(list, 'star').map((c) => c.title)
      // "Star" (substring at 0) beats "Go to Starred" (substring at 6).
      expect(results).toEqual(['Star', 'Go to Starred'])

      // Subsequence: "mdn" matches "Mark Done" in order.
      expect(filterCommands(list, 'mdn').map((c) => c.title)).toEqual(['Mark Done'])
    })

    it('returns the full list for an empty query', async () => {
      const { filterCommands } = await setupCommands()
      const list = [{ title: 'A' }, { title: 'B' }]
      expect(filterCommands(list, '  ')).toEqual(list)
    })
  })
})
