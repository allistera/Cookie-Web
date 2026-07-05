import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, it, expect } from 'vitest'
import { useInboxStore } from '../inbox'

describe('Inbox Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
    expect(store.unreadInboxCount).toBe(14)

    store.completeTodo('todo-kitchen')
    expect(store.unreadInboxCount).toBe(13)
  })
})
