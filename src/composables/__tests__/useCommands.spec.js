import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'

import { useCommands } from '../useCommands'
import { useInboxStore } from '../../stores/inbox'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useDocumentsStore } from '../../stores/documents'
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
      { path: '/documents/:id?', name: 'documents', component: { template: '<div />' } },
      { path: '/drafts', name: 'drafts', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      { path: '/scheduled', name: 'scheduled-sends', component: { template: '<div />' } },
      { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
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

  it('Create Event requests a new event from the store, going to Calendar first when elsewhere', async () => {
    const { commands, push } = await setupCommands()
    const createEvent = commands.value.find((c) => c.id === 'calendar-create-event')
    expect(createEvent.title).toBe('Create Event')

    expect(store.calendarNewEventRequestId).toBe(0)
    await createEvent.run()
    expect(push).toHaveBeenCalledWith({ name: 'calendar' })
    expect(store.calendarNewEventRequestId).toBe(1)
    expect(store.calendarNewEventPending).toBe(true)

    const onCalendar = await setupCommands('calendar')
    await onCalendar.commands.value.find((c) => c.id === 'calendar-create-event').run()
    expect(onCalendar.push).not.toHaveBeenCalled()
    expect(store.calendarNewEventRequestId).toBe(2)
  })

  it('New Document and New Task go to their app and raise the request there', async () => {
    const { commands, push } = await setupCommands()
    const byId = Object.fromEntries(commands.value.map((c) => [c.id, c]))
    const documents = useDocumentsStore()
    vi.spyOn(documents, 'loadTemplates').mockResolvedValue()

    await byId['new-document'].run()
    expect(push).toHaveBeenCalledWith({ name: 'documents' })
    expect(documents.newDocumentDialogOpen).toBe(true)

    const tasks = useTaskItemsStore()
    await byId['new-task'].run()
    expect(push).toHaveBeenCalledWith({ name: 'tasks', query: { project: 'inbox' } })
    expect(tasks.newTaskRequestId).toBe(1)
    expect(tasks.newTaskPending).toBe(true)
  })

  it('offers a theme switch to the opposite of the resolved theme', async () => {
    localStorage.setItem('cookie-theme', 'light')
    const { commands } = await setupCommands()
    const ids = () => commands.value.map((c) => c.id)
    expect(ids()).toContain('theme-dark')
    expect(ids()).not.toContain('theme-light')

    commands.value.find((c) => c.id === 'theme-dark').run()
    expect(localStorage.getItem('cookie-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    localStorage.removeItem('cookie-theme')
  })

  it('always offers a Compose command that opens the composer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }),
    )
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

    expect(byId['mark-done'].keyHint).toBe('D')
    expect(byId['star'].title).toBe('Unstar')
    expect(byId['toggle-read'].title).toBe('Mark Unread')
    expect(byId['move'].comingSoon).toBe(true)
    expect(byId['reply']).toBeTruthy()
    expect(byId['reply-all']).toBeTruthy()
    expect(byId['forward']).toBeTruthy()
  })

  it('reply, forward and snooze hand the open email to the reading panel', async () => {
    const email = makeEmail()
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    const { commands, push } = await setupCommands('traditional-inbox')
    const byId = Object.fromEntries(commands.value.map((c) => [c.id, c]))

    await byId['reply-all'].run()
    expect(push).not.toHaveBeenCalled()
    expect(store.readerActionRequest).toMatchObject({ id: 1, action: 'reply-all' })

    await byId['forward'].run()
    expect(store.readerActionRequest).toMatchObject({ id: 2, action: 'forward' })

    const snoozes = commands.value.filter((c) => c.id.startsWith('snooze-'))
    expect(snoozes.map((c) => c.title)).toContain('Snooze until tomorrow')
    await snoozes[0].run()
    expect(store.readerActionRequest.action).toBe('snooze')
    expect(store.readerActionRequest.payload.date).toBeInstanceOf(Date)
  })

  it('reply from another route returns to the inbox before raising the request', async () => {
    const email = makeEmail()
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    const { commands, push } = await setupCommands('calendar')
    await commands.value.find((c) => c.id === 'reply').run()
    expect(push).toHaveBeenCalledWith('/inbox')
    expect(store.readerActionRequest).toMatchObject({ action: 'reply' })
  })

  it('offers one label toggle per palette label while an email is open', async () => {
    const home = { id: 'l1', name: 'Home', color: '#f00', kind: 'user' }
    store.labels = [home, { id: 'l2', name: 'Work', color: '#0f0', kind: 'user' }]
    const email = makeEmail({ labels: [home] })
    store.traditionalEmails = [email]
    store.openEmailId = email.id
    const toggle = vi.spyOn(store, 'toggleMessageLabel').mockResolvedValue()

    const { commands } = await setupCommands()
    const labelCmds = commands.value.filter((c) => c.id.startsWith('label-'))
    expect(labelCmds.map((c) => c.title)).toEqual(['Remove label Home', 'Label as Work'])

    labelCmds[1].run()
    expect(toggle).toHaveBeenCalledWith(email, store.labels[1])
  })

  it('switches inbox tabs, returning to the plain inbox when filtered', async () => {
    store.labels = [{ id: 'l1', name: 'Home', color: '#f00', kind: 'user' }]

    const { commands, push } = await setupCommands('calendar')
    const tabs = commands.value.filter((c) => c.id.startsWith('tab-'))
    expect(tabs.map((c) => c.title)).toEqual([
      'Switch to Priority tab',
      'Switch to Home tab',
      'Switch to Other tab',
    ])

    tabs[1].run()
    expect(store.inboxTab).toBe('label:Home')
    expect(push).toHaveBeenCalledWith('/inbox')
  })

  it('opens each settings section directly', async () => {
    const { commands, push } = await setupCommands()
    const sections = commands.value.filter((c) => c.id.startsWith('settings-'))
    expect(sections.map((c) => c.title)).toContain('Settings: Appearance')
    expect(sections).toHaveLength(12)

    sections.find((c) => c.id === 'settings-rules').run()
    expect(push).toHaveBeenCalledWith({ name: 'settings', params: { section: 'rules' } })
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

    byId['go-calendar'].run()
    expect(push).toHaveBeenCalledWith({ name: 'calendar' })

    byId['go-documents'].run()
    expect(push).toHaveBeenCalledWith({ name: 'documents' })

    byId['go-ai-today'].run()
    expect(push).toHaveBeenCalledWith({ name: 'ai-inbox' })

    byId['go-tasks'].run()
    expect(push).toHaveBeenCalledWith({ name: 'tasks' })

    byId['go-drafts'].run()
    expect(push).toHaveBeenCalledWith({ name: 'drafts' })

    byId['open-settings'].run()
    expect(push).toHaveBeenCalledWith({ name: 'settings', params: { section: 'account' } })
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
