import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAuth0Client } from '../../auth0-client'
import { normalizeSender, useSendersStore } from '../senders'
import { useInboxStore } from '../inbox'

const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const empty = { enabled: false, decisions: [], nextCursor: null }
let store
beforeEach(() => {
  setActivePinia(createPinia())
  setAuth0Client(null)
  store = useSendersStore()
  store.setOwner('account-a')
})
afterEach(() => vi.unstubAllGlobals())

describe('account-scoped sender state', () => {
  it('defaults off, normalizes without merging aliases, and pages an explicit decision list', async () => {
    expect(store.enabled).toBe(false)
    expect(normalizeSender(' Name+alias@EXAMPLE.COM ')).toBe('name+alias@example.com')
    const first = { address: 'a@example.com', decision: 'blocked' }
    const second = { address: 'b@example.com', decision: 'accepted' }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ...empty, decisions: [first], nextCursor: first.address }))
      .mockResolvedValueOnce(response({ ...empty, decisions: [second] }))
    vi.stubGlobal('fetch', fetcher)
    await store.load()
    await store.load({ more: true })
    expect(store.decisions).toEqual([first, second])
    expect(fetcher.mock.calls[1][0]).toContain('after=a%40example.com')
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store')
  })
  it('drops old account reads and writes, and clears private addresses on logout', async () => {
    let finish
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        )
        .mockResolvedValue(response(empty)),
    )
    const old = store.load()
    await vi.waitFor(() => expect(finish).toBeDefined())
    store.setOwner('account-b')
    await store.load()
    finish(
      response({
        enabled: true,
        decisions: [{ address: 'private@example.com', decision: 'blocked' }],
        nextCursor: null,
      }),
    )
    await old
    expect(store.decisions).toEqual([])
    expect(store.enabled).toBe(false)
    store.known = { 'private@example.com': 'blocked' }
    store.setOwner(null)
    expect(store.known).toEqual({})
    expect(store.loaded).toBe(false)
  })
  it('does not overwrite a saved block with an older in-flight lookup', async () => {
    let finish
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        )
        .mockResolvedValue(response({ address: 'a@example.com', decision: 'blocked' })),
    )
    const old = store.lookup('a@example.com')
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(await store.update({ action: 'block', address: 'a@example.com' })).toBe(true)
    finish(response(empty))
    await old
    expect(store.known['a@example.com']).toBe('blocked')
  })
  it('reports failed decisions without optimistic release or enabling screening', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'Message not found' }, 404)))
    store.known['a@example.com'] = 'blocked'
    expect(await store.update({ action: 'accept', address: 'a@example.com' })).toBe(false)
    expect(store.known['a@example.com']).toBe('blocked')
    expect(store.enabled).toBe(false)
    expect(store.error).toBe('Message not found')
  })
})

describe('review-folder isolation', () => {
  it('drops a prior owner queue response and clears both review lists when the account changes', async () => {
    const inbox = useInboxStore()
    inbox.setComposeOwner('account-a')
    let finish
    vi.spyOn(inbox, 'fetchEmailPage').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const old = inbox.loadFolder('screening')
    inbox.blockedEmails = [{ id: 'private' }]
    inbox.setComposeOwner('account-b')
    finish({ emails: [{ id: 'old-account', screening_status: 'held' }], nextCursor: null })
    await old
    expect(inbox.screeningEmails).toEqual([])
    expect(inbox.blockedEmails).toEqual([])
    expect(inbox.isScreeningRefreshing).toBe(false)
  })
  it('keeps held mail out of ordinary folders when starring or changing its spam verdict', async () => {
    const inbox = useInboxStore()
    vi.spyOn(inbox, 'updateMessage').mockResolvedValue()
    const email = {
      id: 'held',
      screeningStatus: 'held',
      isSpam: true,
      labels: [],
      starred: false,
      unread: true,
    }
    inbox.screeningEmails = [email]
    inbox.isInboxLoaded = inbox.isStarredLoaded = inbox.isSpamLoaded = true
    inbox.toggleStar(email)
    inbox.setSpam(email, false, false)
    await Promise.resolve()
    expect(inbox.starredEmails).toEqual([])
    expect(inbox.traditionalEmails).toEqual([])
    expect(inbox.screeningEmails[0]).toMatchObject({
      screeningStatus: 'held',
      isSpam: false,
      starred: true,
    })
    expect(inbox.unreadInboxCount).toBe(0)
  })
  it('does not repopulate cleared body caches from a pre-block response', async () => {
    const inbox = useInboxStore()
    inbox.setComposeOwner('account-a')
    let finish
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ),
    )
    vi.spyOn(inbox, 'refreshInbox').mockResolvedValue()
    const old = inbox.fetchMessageBody('message')
    await vi.waitFor(() => expect(finish).toBeDefined())
    await inbox.refreshSenderMail()
    finish(response({ body_text: 'Before block', screening_status: 'allowed' }))
    expect(await old).toBeNull()
    expect(inbox.messageBodies.size).toBe(0)
  })
})
