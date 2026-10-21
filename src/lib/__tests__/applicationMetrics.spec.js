import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let recordTiming, connectMetrics, sanitizeMetric
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('PROD', true)
  vi.stubEnv('VITE_E2E', 'false')
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.com/1')
  ;({ recordTiming, connectMetrics, sanitizeMetric } = await import('../applicationMetrics'))
})
afterEach(() => vi.unstubAllEnvs())

describe('application metrics', () => {
  it('sends each completed shared timer only once', async () => {
    const { startTiming } = await import('../performance')
    vi.stubGlobal('performance', {
      now: vi.fn().mockReturnValueOnce(10).mockReturnValue(25),
      measure: vi.fn(),
      clearMeasures: vi.fn(),
    })
    const metrics = { count: vi.fn(), distribution: vi.fn() }
    try {
      connectMetrics(metrics)
      const finish = startTiming('message-body')
      finish()
      finish()
      expect(metrics.count).toHaveBeenCalledExactlyOnceWith('web.operations', 1, {
        attributes: { service: 'cookie-web', operation: 'message-body' },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('buffers at most 100 early timings and emits once after the SDK loads', () => {
    const metrics = { count: vi.fn(), distribution: vi.fn() }
    for (let i = 0; i < 110; i++) recordTiming('route-ready', 12)
    connectMetrics(metrics)
    expect(metrics.count).toHaveBeenCalledTimes(100)
    connectMetrics(metrics)
    expect(metrics.count).toHaveBeenCalledTimes(100)
    recordTiming('request:post', 42)
    expect(metrics.distribution).toHaveBeenLastCalledWith('web.operation.duration', 42, {
      unit: 'millisecond',
      attributes: { service: 'cookie-web', operation: 'request:post' },
    })
  })

  it.each([
    ['PROD', false],
    ['VITE_E2E', 'true'],
    ['VITE_SENTRY_DSN', ''],
  ])('does not collect with %s=%s', (key, value) => {
    vi.stubEnv(key, value)
    const metrics = { count: vi.fn(), distribution: vi.fn() }
    recordTiming('search', 1)
    connectMetrics(metrics)
    recordTiming('search', 1)
    expect(metrics.count).not.toHaveBeenCalled()
  })

  it('rejects arbitrary labels and invalid durations and tolerates SDK failures', () => {
    const metrics = {
      count: vi.fn(() => {
        throw new Error('unavailable')
      }),
      distribution: vi.fn(),
    }
    connectMetrics(metrics)
    recordTiming('private mailbox', 1)
    recordTiming('search', NaN)
    recordTiming('search', -1)
    expect(metrics.count).not.toHaveBeenCalled()
    expect(() => recordTiming('search', 10)).not.toThrow()
  })

  it('removes automatically enriched identity and arbitrary attributes', () => {
    const input = {
      name: 'web.operations',
      value: 1,
      attributes: {
        operation: 'search',
        'user.email': 'private@example.com',
        url: 'secret',
      },
    }
    expect(sanitizeMetric(input)).toEqual({
      name: 'web.operations',
      value: 1,
      type: 'counter',
      attributes: { service: 'cookie-web', operation: 'search' },
    })
    expect(sanitizeMetric({ ...input, name: 'private' })).toBeNull()
    expect(sanitizeMetric({ ...input, value: Infinity })).toBeNull()
    expect(sanitizeMetric({ ...input, attributes: { operation: 'private' } })).toBeNull()
  })
})
