import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createErrorCapture } from '../sentry.js'

// A fresh capture per test gives an isolated init/flush lifecycle, the same
// reset vi.resetModules used to provide against the module singleton.
const sentry = {
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}

describe('captureApiError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stays disabled outside Vercel when no explicit DSN is configured', async () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('SENTRY_DSN', '')
    const captureApiError = createErrorCapture(async () => sentry)

    await captureApiError(new Error('local failure'))

    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('initializes error reporting once and flushes each captured exception', async () => {
    vi.stubEnv('VERCEL', '1')
    const captureApiError = createErrorCapture(async () => sentry)
    const first = new Error('first failure')
    const second = new Error('second failure')

    await captureApiError(first, { route: 'GET /api/test' })
    await captureApiError(second)

    expect(sentry.init).toHaveBeenCalledTimes(1)
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: expect.stringContaining('sentry.io'),
    })
    expect(sentry.captureException).toHaveBeenNthCalledWith(1, first, {
      extra: { route: 'GET /api/test' },
    })
    expect(sentry.captureException).toHaveBeenNthCalledWith(2, second, { extra: {} })
    expect(sentry.flush).toHaveBeenCalledTimes(2)
    expect(sentry.flush).toHaveBeenCalledWith(2000)
  })
})
