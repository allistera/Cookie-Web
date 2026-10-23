import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useContactInsightsStore } from '../contactInsights'
import { useInboxStore } from '../inbox'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useInboxStore(), 'authHeaders').mockResolvedValue({})
})

describe('contact insights store', () => {
  it('loads a contact and its recent history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contact: {
            address: 'alex@example.com',
            name: 'Alex',
            company: null,
            role: null,
            linkedinUrl: null,
            notes: '',
          },
          history: [{ id: 'message-1', subject: 'Hello' }],
          nextCursor: null,
        }),
      }),
    )
    const store = useContactInsightsStore()

    await store.openContact({ address: ' Alex@Example.com ', name: 'Fallback name' })

    expect(store.contact.name).toBe('Alex')
    expect(store.history).toEqual([{ id: 'message-1', subject: 'Hello' }])
    expect(store.isOpen).toBe(true)
  })

  it('loads the screening decision that applies to the contact', async () => {
    const fetch = vi.fn().mockImplementation(async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes('/emails/senders')
          ? { enabled: true, decisions: [{ address: '@example.com', decision: 'blocked' }] }
          : {
              contact: { address: 'alex@example.com', name: 'Alex' },
              history: [],
              nextCursor: 'c1',
            },
    }))
    vi.stubGlobal('fetch', fetch)
    const store = useContactInsightsStore()

    await store.openContact({ address: 'alex@example.com' })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/emails/senders?address=alex%40example.com'),
      expect.anything(),
    )
    expect(store.screening).toEqual({ key: '@example.com', decision: 'blocked', failed: false })

    // Paging the history keeps the decision without asking for it again.
    await store.loadContact({ more: true })
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes('/emails/senders')),
    ).toHaveLength(1)
    expect(store.screening).toEqual({ key: '@example.com', decision: 'blocked', failed: false })
  })

  it('records when no decision applies and when the lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url) => ({
        ok: true,
        json: async () =>
          String(url).includes('/emails/senders')
            ? { enabled: false, decisions: [] }
            : { contact: { address: 'alex@example.com' }, history: [], nextCursor: null },
      })),
    )
    const store = useContactInsightsStore()
    await store.openContact({ address: 'alex@example.com' })
    expect(store.screening).toEqual({ key: null, decision: null, failed: false })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url) => ({
        ok: !String(url).includes('/emails/senders'),
        status: 500,
        json: async () => ({
          contact: { address: 'blair@example.com' },
          history: [],
          nextCursor: null,
        }),
      })),
    )
    await store.openContact({ address: 'blair@example.com' })
    // The contact still loads; only the decision is marked unknown.
    expect(store.contact.address).toBe('blair@example.com')
    expect(store.loadError).toBe('')
    expect(store.screening).toEqual({ key: null, decision: null, failed: true })
  })

  it('preserves the known display name when a save response has no name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contact: {
            address: 'alex@example.com',
            name: null,
            company: 'Example Studio',
            role: null,
            linkedinUrl: null,
            notes: '',
          },
        }),
      }),
    )
    const store = useContactInsightsStore()
    store.contact = { address: 'alex@example.com', name: 'Alex' }

    await store.saveContact('alex@example.com', { company: 'Example Studio' })

    expect(store.contact.name).toBe('Alex')
    expect(store.contact.company).toBe('Example Studio')
  })
})
