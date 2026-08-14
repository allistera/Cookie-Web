import { describe, expect, it, vi } from 'vitest'

import { scheduleIdleTask } from '../scheduleIdleTask'

describe('scheduleIdleTask', () => {
  it('prefers an idle callback with a bounded timeout', () => {
    const task = vi.fn()
    const requestIdleCallback = vi.fn()

    scheduleIdleTask(task, { requestIdleCallback })

    expect(requestIdleCallback).toHaveBeenCalledWith(task, { timeout: 2000 })
  })

  it('falls back to a zero-delay timer', () => {
    const task = vi.fn()
    const setTimeout = vi.fn()

    scheduleIdleTask(task, { setTimeout })

    expect(setTimeout).toHaveBeenCalledWith(task, 0)
  })
})
