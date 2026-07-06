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
        date: '10:04 AM',
        unread: true,
        starred: false,
      },
    ])
    expect(store.unreadInboxCount).toBe(1)
    expect(store.statusTime).toBe('Updated just now')
    expect(store.isRefreshing).toBe(false)
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
