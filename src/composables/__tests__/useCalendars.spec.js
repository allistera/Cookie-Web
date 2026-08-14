import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CALENDARS_ENDPOINT, useCalendars } from '../useCalendars'

describe('useCalendars', () => {
  let authHeaders
  let notify

  beforeEach(() => {
    authHeaders = vi.fn().mockResolvedValue({})
    notify = vi.fn()
    // The composable's state is module-level (shared across every caller by
    // design); reset it so tests in this file don't leak into each other.
    const { calendars } = useCalendars(authHeaders, notify)
    calendars.value = []
  })

  it('loads calendars and splits them into writable vs subscribed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          calendars: [
            { id: 'work', name: 'Work' },
            { id: 'holidays', name: 'Holidays', subscriptionUrl: 'https://example.com/cal.ics' },
          ],
        }),
      }),
    )

    const { calendars, writableCalendars, subscribedCalendars, loadCalendars } = useCalendars(
      authHeaders,
      notify,
    )
    await loadCalendars()

    expect(fetch).toHaveBeenCalledWith(CALENDARS_ENDPOINT, { headers: {} })
    expect(calendars.value).toHaveLength(2)
    expect(writableCalendars.value.map((c) => c.id)).toEqual(['work'])
    expect(subscribedCalendars.value.map((c) => c.id)).toEqual(['holidays'])
  })

  it('notifies and leaves calendars untouched on a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { calendars, loadCalendars } = useCalendars(authHeaders, notify)
    calendars.value = [{ id: 'work', name: 'Work' }]
    await loadCalendars()

    expect(calendars.value).toEqual([{ id: 'work', name: 'Work' }])
    expect(notify).toHaveBeenCalledWith('Failed to load calendars.', 'error')
  })

  it('shares one calendars list across every caller', () => {
    const first = useCalendars(authHeaders, notify)
    const second = useCalendars(authHeaders, notify)

    first.calendars.value.push({ id: 'work', name: 'Work' })

    // Proves the fix for the stale-state bug: a mutation made through one
    // component's useCalendars() call (e.g. CalendarSettings renaming or
    // creating a calendar) is immediately visible through another's (e.g.
    // an already-mounted CalendarView), with no separate fetch needed.
    expect(second.calendars.value).toEqual([{ id: 'work', name: 'Work' }])
    expect(second.writableCalendars.value).toEqual([{ id: 'work', name: 'Work' }])
  })
})
