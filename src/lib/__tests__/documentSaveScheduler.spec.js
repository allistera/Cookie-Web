import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocumentSaveScheduler } from '../documentSaveScheduler'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('document save scheduler', () => {
  it('coalesces rapid changes into one trailing save', async () => {
    const save = vi.fn()
    const scheduler = createDocumentSaveScheduler(save, 300)

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()

    await vi.advanceTimersByTimeAsync(299)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushes pending work immediately and clears its timer', async () => {
    const save = vi.fn()
    const scheduler = createDocumentSaveScheduler(save, 300)

    scheduler.schedule()
    await scheduler.flush()

    expect(save).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('runs one follow-up save when changes arrive during an in-flight save', async () => {
    let releaseFirstSave
    const firstSave = new Promise((resolve) => {
      releaseFirstSave = resolve
    })
    const save = vi.fn().mockReturnValueOnce(firstSave)
    const scheduler = createDocumentSaveScheduler(save, 300)

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledTimes(1)

    scheduler.schedule()
    scheduler.schedule()
    releaseFirstSave()
    await scheduler.flush()

    expect(save).toHaveBeenCalledTimes(2)
  })
})
