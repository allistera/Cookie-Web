import { createPinia, setActivePinia } from 'pinia'
import { markRaw } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEND_API_URL } from '../../lib/apiWorkers'
import { useInboxStore } from '../inbox'

const INVITATION = 'invitation-1'
let store

const answered = (overrides = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    invitation: {
      id: INVITATION,
      response: 'accepted',
      responded_at: '2026-11-17T12:00:00.000Z',
      event: { id: 'event-1', date: '2026-12-01' },
      ...overrides,
    },
    sent: true,
  }),
})

beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
  store.composeOwnerSub = 'account-a'
  vi.spyOn(store, 'authHeaders').mockResolvedValue({ Authorization: 'Bearer token' })
  // The original invitation mail, an update to it, and an unrelated message.
  store.messageBodies.set(
    'invite',
    markRaw({ text: 'Invite', calendarInvitation: { id: INVITATION, title: 'Team sync' } }),
  )
  store.messageBodies.set(
    'update',
    markRaw({ text: 'Update', calendarInvitation: { id: INVITATION, title: 'Team sync' } }),
  )
  store.messageBodies.set(
    'other',
    markRaw({ text: 'Other', calendarInvitation: { id: 'invitation-2', response: null } }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('respondToInvitation', () => {
  it('posts the answer and the reader’s time zone to the send Worker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answered())
    vi.stubGlobal('fetch', fetchMock)

    expect(await store.respondToInvitation(INVITATION, 'accepted')).toEqual({
      ok: true,
      error: '',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${SEND_API_URL}/send/invitation-reply`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body)).toEqual({
      invitationId: INVITATION,
      response: 'accepted',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    })
  })

  it('writes the answer into every cached message of that invitation, and no other', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answered()))

    await store.respondToInvitation(INVITATION, 'accepted')

    for (const id of ['invite', 'update']) {
      expect(store.messageBodies.get(id).calendarInvitation).toEqual({
        id: INVITATION,
        title: 'Team sync',
        response: 'accepted',
        responded_at: '2026-11-17T12:00:00.000Z',
        event: { id: 'event-1', date: '2026-12-01' },
      })
    }
    expect(store.messageBodies.get('other').calendarInvitation).toEqual({
      id: 'invitation-2',
      response: null,
    })
    store.openEmailId = 'update'
    expect(store.openEmailCalendarInvitation.response).toBe('accepted')
  })

  it('records what the Worker says stands, which a later answer may have replaced', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(answered({ response: 'declined', event: null })),
    )

    await store.respondToInvitation(INVITATION, 'accepted')

    expect(store.messageBodies.get('invite').calendarInvitation).toMatchObject({
      response: 'declined',
      event: null,
    })
  })

  it('reports the Worker’s reason when it refuses, and leaves the invitation as it was', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'This invitation was cancelled by its organiser' }),
      }),
    )

    expect(await store.respondToInvitation(INVITATION, 'accepted')).toEqual({
      ok: false,
      error: 'This invitation was cancelled by its organiser',
    })
    expect(store.messageBodies.get('invite').calendarInvitation).toEqual({
      id: INVITATION,
      title: 'Team sync',
    })
  })

  it('falls back to its own words when the failure carries none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))
    expect(await store.respondToInvitation(INVITATION, 'declined')).toEqual({
      ok: false,
      error: 'The reply could not be sent. Try again.',
    })
  })

  it('reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await store.respondToInvitation(INVITATION, 'accepted')).toEqual({
      ok: false,
      error: 'The reply could not be sent. Check your connection and try again.',
    })
  })

  it('drops the result when the account changed while the reply was in flight', async () => {
    let finish
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(answered())
          }),
      ),
    )

    const pending = store.respondToInvitation(INVITATION, 'accepted')
    await vi.waitFor(() => expect(finish).toBeDefined())
    store.composeGeneration += 1
    finish()

    expect((await pending).ok).toBe(false)
    expect(store.messageBodies.get('invite').calendarInvitation.response).toBeUndefined()
  })
})
