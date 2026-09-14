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
