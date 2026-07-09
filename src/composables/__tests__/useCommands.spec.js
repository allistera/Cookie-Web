import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'

import { useCommands } from '../useCommands'
import { useInboxStore } from '../../stores/inbox'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('../../auth0-client', () => ({
  getAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') }),
}))

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
    push.mockClear()
    store = useInboxStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides email commands when no email is open', () => {
    const { commands } = useCommands()

    const ids = commands.value.map((c) => c.id)
    expect(ids).not.toContain('mark-done')
    expect(ids).not.toContain('star')
    expect(ids).toContain('go-inbox')
    expect(ids).toContain('open-settings')
  })

  it('shows email commands when an email is open, with state-aware titles', () => {
    const email = makeEmail({ starred: true, unread: false })
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    const { commands } = useCommands()
    const byId = Object.fromEntries(commands.value.map((c) => [c.id, c]))

    expect(byId['mark-done'].keyHint).toBe('E')
    expect(byId['star'].title).toBe('Unstar')
    expect(byId['toggle-read'].title).toBe('Mark Unread')
    expect(byId['snooze'].comingSoon).toBe(true)
    expect(byId['move'].comingSoon).toBe(true)
    expect(byId['label'].comingSoon).toBe(true)
  })

  it('creates one navigation command per label', () => {
    store.traditionalEmails = [
      makeEmail({ id: 'a', labels: [{ name: 'Home', color: '#f00' }] }),
      makeEmail({ id: 'b', labels: [{ name: 'Work', color: '#0f0' }] }),
    ]

    const { commands } = useCommands()
    const labelCmds = commands.value.filter((c) => c.id.startsWith('go-label-'))
    expect(labelCmds.map((c) => c.title)).toEqual(['Go to label Home', 'Go to label Work'])

    labelCmds[0].run()
    expect(push).toHaveBeenCalledWith({
      path: '/inbox',
      query: { filter: 'label', label: 'Home' },
    })
  })

  it('navigation commands push the filter routes', () => {
    const { commands } = useCommands()
    const byId = Object.fromEntries(commands.value.map((c) => [c.id, c]))

    byId['go-starred'].run()
    expect(push).toHaveBeenCalledWith({ path: '/inbox', query: { filter: 'starred' } })

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

    const { commands } = useCommands()
    commands.value.find((c) => c.id === 'mark-done').run()

    expect(store.traditionalEmails).toHaveLength(0)
    expect(store.openEmailId).toBe(null)
    expect(store.toasts.some((t) => t.message === 'Marked done.')).toBe(true)
  })

  describe('filterCommands', () => {
    it('ranks substring matches above subsequence matches and drops non-matches', () => {
      const { filterCommands } = useCommands()
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

    it('returns the full list for an empty query', () => {
      const { filterCommands } = useCommands()
      const list = [{ title: 'A' }, { title: 'B' }]
      expect(filterCommands(list, '  ')).toEqual(list)
    })
  })
})
