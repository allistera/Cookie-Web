import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useCalendars', () => {
  let authHeaders
  let notify
  let CALENDARS_ENDPOINT
  let useCalendars
  let setCalendarsOwner

  // The composable's state (calendars, loaded, inFlight) is module-level
  // (shared across every caller by design); reset the module itself between
  // tests so they don't leak into each other.
  beforeEach(async () => {
    vi.resetModules()
    ;({ CALENDARS_ENDPOINT, useCalendars, setCalendarsOwner } = await import('../useCalendars'))
    authHeaders = vi.fn().mockResolvedValue({})
    notify = vi.fn()
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

  it('clears calendars on account switch and ignores a previous account response', async () => {
    let resolveOld
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce({ ok: true, json: async () => ({ calendars: [{ id: 'new-owner' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    setCalendarsOwner('old')
    const { calendars, loadCalendars } = useCalendars(authHeaders, notify)
    calendars.value = [{ id: 'old-owner' }]
    const oldLoad = loadCalendars()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    setCalendarsOwner('new')
    expect(calendars.value).toEqual([])
    await loadCalendars()
    resolveOld({ ok: true, json: async () => ({ calendars: [{ id: 'private-old-calendar' }] }) })
    await oldLoad
    expect(calendars.value).toEqual([{ id: 'new-owner' }])
    setCalendarsOwner(null)
    expect(calendars.value).toEqual([])
  })

  it('does not write a delayed sync result into another account cache', async () => {
    let resolveSync
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSync = resolve
          }),
      ),
    )
    setCalendarsOwner('old')
    const { calendars, syncCalendar } = useCalendars(authHeaders, notify)
    calendars.value = [{ id: 'shared-test-id' }]
    const sync = syncCalendar('shared-test-id')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    setCalendarsOwner('new')
    calendars.value = [{ id: 'shared-test-id', name: 'New calendar' }]
    resolveSync({ ok: true, json: async () => ({ subscriptionSyncedAt: 'private-old-timestamp' }) })
    await sync
    expect(calendars.value).toEqual([{ id: 'shared-test-id', name: 'New calendar' }])
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

  it('syncCalendar posts the sync and writes the outcome onto the shared row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ subscriptionError: 'feed offline' }),
      }),
    )

    const { calendars, syncCalendar } = useCalendars(authHeaders, notify)
    calendars.value = [{ id: 'hol', name: 'Holidays', subscriptionSyncedAt: 'before' }]
    const result = await syncCalendar('hol')

    expect(fetch).toHaveBeenCalledWith(CALENDARS_ENDPOINT, {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ action: 'sync', id: 'hol' }),
    })
    expect(result).toEqual({ ok: false, errorMessage: 'feed offline' })
    expect(calendars.value[0]).toEqual({
      id: 'hol',
      name: 'Holidays',
      subscriptionSyncedAt: 'before',
      subscriptionError: 'feed offline',
    })
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

  it('does not refetch a second caller already loaded on mount, unless forced', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ calendars: [{ id: 'work', name: 'Work' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    // Mirrors CalendarView + DocumentCalendarSidebar both calling
    // loadCalendars() on mount within moments of each other.
    const sidebar = useCalendars(authHeaders, notify)
    const view = useCalendars(authHeaders, notify)
    await sidebar.loadCalendars()
    await view.loadCalendars()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    // CalendarSettings always wants fresh data (e.g. after a subscription
    // synced elsewhere), so it opts back in with force.
    await view.loadCalendars({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent calls into a single in-flight request', async () => {
    let resolveFetch
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { loadCalendars } = useCalendars(authHeaders, notify)
    const first = loadCalendars()
    const second = loadCalendars()

    // authHeaders() and fetch() are both awaited before the mock is called,
    // so give those microtasks a chance to run before resolving it.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolveFetch({ ok: true, json: async () => ({ calendars: [] }) })
    await Promise.all([first, second])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('chains one fresh fetch after an in-flight load when forced', async () => {
    const resolvers = []
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { calendars, loadCalendars } = useCalendars(authHeaders, notify)
    const unforced = loadCalendars()
    const forced = loadCalendars({ force: true })
    const alsoForced = loadCalendars({ force: true })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolvers[0]({ ok: true, json: async () => ({ calendars: [{ id: 'stale' }] }) })
    await unforced

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    resolvers[1]({ ok: true, json: async () => ({ calendars: [{ id: 'fresh' }] }) })
    await expect(Promise.all([forced, alsoForced])).resolves.toEqual([true, true])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(calendars.value).toEqual([{ id: 'fresh' }])
  })
})
