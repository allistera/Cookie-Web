import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useInboxStore } from '../inbox'

vi.mock('../../auth0-client', () => ({
  getAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') }),
}))

describe('Inbox Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('completes a todo and promotes the next hidden todo', () => {
    const store = useInboxStore()

    // Initial state check
    expect(store.totalActiveTodosCount).toBe(5)
    expect(store.visibleTodos.length).toBe(3)

    // Check hidden count
    expect(store.hiddenTodosCount).toBe(2)

    // Complete a visible todo (RSVP for College Tour)
    const collegeTourId = 'todo-waiver'
    store.completeTodo(collegeTourId)

    // The completed todo should be removed from active lists
    const completedTodo = store.todos.find((t) => t.id === collegeTourId)
    expect(completedTodo.completed).toBe(true)

    // Total active todos should decrement to 4
    expect(store.totalActiveTodosCount).toBe(4)

    // One of the hidden todos (Resale Marketplace Sale) should be promoted
    const marketplaceTodo = store.todos.find((t) => t.id === 'todo-marketplace')
    expect(marketplaceTodo.visible).toBe(true)

    // Visible todos should remain 3 (since 1 completed left and 1 promoted joined)
    expect(store.visibleTodos.length).toBe(3)

    // Hidden active todos should decrement to 1
    expect(store.hiddenTodosCount).toBe(1)
  })

  it('decrements unread inbox count upon completion', () => {
    const store = useInboxStore()
    store.unreadInboxCount = 5

    store.completeTodo('todo-kitchen')
    expect(store.unreadInboxCount).toBe(4)
  })

  it('loads emails from the API and maps them for the inbox list', async () => {
    const sentAt = new Date()
    sentAt.setHours(10, 4, 0, 0)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'abc-123',
              from_name: 'City Construction',
              from_address: 'updates@cityconstruction.com',
              subject: 'Revised Floor Plan',
              snippet: 'Hi Allister, following up...',
              body_text: 'Hi Allister, following up on our call.\n\nThe revised plan is attached.',
              sent_at: sentAt.toISOString(),
              is_unread: true,
              is_starred: false,
            },
          ],
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadEmails()

    expect(fetch).toHaveBeenCalledWith('/api/emails', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.traditionalEmails).toEqual([
      {
        id: 'abc-123',
        sender: 'City Construction',
        address: 'updates@cityconstruction.com',
        subject: 'Revised Floor Plan',
        snippet: 'Hi Allister, following up...',
        body: 'Hi Allister, following up on our call.\n\nThe revised plan is attached.',
        sentAt: sentAt.toISOString(),
        date: '10:04 am',
        unread: true,
        starred: false,
        labels: [],
      },
    ])
    expect(store.unreadInboxCount).toBe(1)
    expect(store.statusTime).toBe('Updated just now')
    expect(store.isRefreshing).toBe(false)
  })

  it('searches emails and replaces the inbox list with results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'zoom-1',
              from_name: 'Zoom Video',
              from_address: 'billing@zoom.us',
              subject: 'Invoice for subscription renewal',
              snippet: 'Your annual Zoom Pro subscription has renewed...',
              body_text: 'Your annual Zoom Pro subscription has renewed.',
              sent_at: new Date().toISOString(),
              is_unread: false,
              is_starred: false,
            },
          ],
        }),
      }),
    )

    const store = useInboxStore()
    await store.searchEmails('  zoom invoice ')

    expect(fetch).toHaveBeenCalledWith('/api/search?q=zoom%20invoice', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.activeSearchQuery).toBe('zoom invoice')
    expect(store.traditionalEmails).toHaveLength(1)
    expect(store.traditionalEmails[0].subject).toBe('Invoice for subscription renewal')
    expect(store.statusTime).toBe('1 result')
    expect(store.isRefreshing).toBe(false)
  })

  it('notifies and keeps the list when search fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'keep-me' }]
    await store.searchEmails('anything')

    expect(store.traditionalEmails).toEqual([{ id: 'keep-me' }])
    expect(store.activeSearchQuery).toBe('')
    expect(store.toasts[0]).toMatchObject({ kind: 'error' })
  })

  it('ignores a stale search response that resolves after a newer one', async () => {
    const emailRow = (id, subject) => ({
      id,
      from_name: 'Sender',
      from_address: 's@example.com',
      subject,
      snippet: '',
      body_text: '',
      sent_at: new Date().toISOString(),
      is_unread: false,
      is_starred: false,
    })
    let resolveFirst
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(firstResponse)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ emails: [emailRow('new-1', 'Newer result')] }),
        }),
    )

    const store = useInboxStore()
    const first = store.searchEmails('old query')
    await store.searchEmails('new query')
    expect(store.traditionalEmails[0].subject).toBe('Newer result')

    // The stale response arrives late — it must not clobber the newer results.
    resolveFirst({ ok: true, json: async () => ({ emails: [emailRow('old-1', 'Stale result')] }) })
    await first

    expect(store.traditionalEmails[0].subject).toBe('Newer result')
    expect(store.activeSearchQuery).toBe('new query')
  })

  it('clearSearch reloads the full inbox only when a search is active', async () => {
    const store = useInboxStore()

    // No active search: no fetch happens.
    vi.stubGlobal('fetch', vi.fn())
    store.clearSearch()
    expect(fetch).not.toHaveBeenCalled()

    // Active search: clearing reloads /api/emails.
    store.activeSearchQuery = 'zoom'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emails: [] }) }),
    )
    await store.clearSearch()
    expect(store.activeSearchQuery).toBe('')
    expect(fetch).toHaveBeenCalledWith('/api/emails', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
  })

  it('shows a toast and auto-dismisses it', () => {
    vi.useFakeTimers()
    const store = useInboxStore()

    store.notify('Reply sent.')
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0]).toMatchObject({ message: 'Reply sent.', kind: 'info' })

    vi.advanceTimersByTime(4000)
    expect(store.toasts).toHaveLength(0)
    vi.useRealTimers()
  })

  it('dismisses a toast manually', () => {
    vi.useFakeTimers()
    const store = useInboxStore()

    store.notify('Failed to send email.', 'error')
    store.dismissToast(store.toasts[0].id)
    expect(store.toasts).toHaveLength(0)
    vi.useRealTimers()
  })

  it('sends mail through the API with the access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) }),
    )

    const store = useInboxStore()
    const result = await store.sendMail({
      to: 'someone@example.com',
      subject: 'Re: Hello',
      text: 'Hi there',
    })

    expect(fetch).toHaveBeenCalledWith('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ to: 'someone@example.com', subject: 'Re: Hello', text: 'Hi there' }),
    })
    expect(result).toEqual({ id: 'msg-1' })
  })

  it('throws when sending mail fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))

    const store = useInboxStore()
    await expect(
      store.sendMail({ to: 'someone@example.com', subject: 'S', text: 'T' }),
    ).rejects.toThrow('POST /api/send responded 502')
  })

  it('persists read state and updates the unread count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )

    const store = useInboxStore()
    const email = { id: 'abc-123', unread: true }
    store.traditionalEmails = [email, { id: 'def-456', unread: true }]
    store.unreadInboxCount = 2

    store.setUnread(email, false)
    expect(email.unread).toBe(false)
    expect(store.unreadInboxCount).toBe(1)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())

    expect(fetch).toHaveBeenCalledWith('/api/messages', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'abc-123', is_unread: false }),
    })
  })

  it('reverts read state when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useInboxStore()
    const email = { id: 'abc-123', unread: true }
    store.traditionalEmails = [email]
    store.unreadInboxCount = 1

    store.setUnread(email, false)
    await vi.waitFor(() => expect(email.unread).toBe(true))
    expect(store.unreadInboxCount).toBe(1)
    expect(store.toasts.some((t) => t.kind === 'error')).toBe(true)
  })

  it('reports the inbox as unavailable when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useInboxStore()
    await store.loadEmails()

    expect(store.traditionalEmails).toEqual([])
    expect(store.statusTime).toBe('Inbox unavailable')
    expect(store.isRefreshing).toBe(false)
  })
})
