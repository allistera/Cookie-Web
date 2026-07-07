import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockSql, fakeMessage, readFixture } from './helpers.js'

const mocks = vi.hoisted(() => ({ sql: null, neonThrows: false }))

vi.mock('@neondatabase/serverless', () => ({
  neon: (url) => {
    if (mocks.neonThrows) {
      // Mirrors the real driver's leaky validation error.
      throw new Error(`Database connection string provided to \`neon()\` is not a valid URL. Connection string: ${url}`)
    }
    return mocks.sql
  },
}))

const { default: worker } = await import('../src/index.js')

const env = {
  DATABASE_URL: 'postgresql://user:supersecretpassword@host.example.com/db',
  OWNER_EMAIL: 'owner@example.com',
  FORWARD_TO: 'forward@example.com',
}

function fakeCtx() {
  return { waitUntil: vi.fn() }
}

const LOOKUP_ROW = { user_id: '11111111-1111-4111-8111-111111111111', is_duplicate: false, thread_id: null }

function forwardableFixture(overrides = {}) {
  const message = fakeMessage(readFixture('simple.eml'))
  message.forward = vi.fn().mockResolvedValue(undefined)
  return Object.assign(message, overrides)
}

let logSpy
let errorSpy

beforeEach(() => {
  mocks.neonThrows = false
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('email() handler', () => {
  it('stores then forwards exactly once (happy path)', async () => {
    mocks.sql = createMockSql({ lookupRows: [LOOKUP_ROW] }).sql
    const message = forwardableFixture()

    await worker.email(message, env, fakeCtx())

    expect(message.forward).toHaveBeenCalledTimes(1)
    expect(message.forward).toHaveBeenCalledWith('forward@example.com')
    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"outcome":"inserted"'))
  })

  it('still forwards when the store step throws', async () => {
    mocks.sql = Object.assign(() => Promise.reject(new Error('connection refused')), {
      transaction: () => Promise.reject(new Error('connection refused')),
    })
    const message = forwardableFixture()

    await worker.email(message, env, fakeCtx())

    expect(message.forward).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('store_failed'))
  })

  it('still forwards when the store step hangs past the budget', async () => {
    vi.useFakeTimers()
    mocks.sql = Object.assign(() => new Promise(() => {}), { transaction: () => new Promise(() => {}) })
    const message = forwardableFixture()

    const done = worker.email(message, env, fakeCtx())
    await vi.advanceTimersByTimeAsync(5001)
    await done

    expect(message.forward).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('budget'))
  })

  it('never logs message bodies on failure', async () => {
    mocks.sql = Object.assign(() => Promise.reject(new Error('boom')), {
      transaction: () => Promise.reject(new Error('boom')),
    })
    const message = forwardableFixture()

    await worker.email(message, env, fakeCtx())

    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('Hello from the simple fixture')
  })

  it('skips parse/store entirely for oversized messages but still forwards', async () => {
    let sqlCalled = false
    mocks.sql = Object.assign(
      () => {
        sqlCalled = true
        return Promise.resolve([])
      },
      { transaction: () => Promise.resolve([]) },
    )
    const message = forwardableFixture({ rawSize: 11 * 1024 * 1024 })

    await worker.email(message, env, fakeCtx())

    expect(message.forward).toHaveBeenCalledTimes(1)
    expect(sqlCalled).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('store_skipped_oversize'))
  })

  it('never logs the connection string when neon() rejects the URL', async () => {
    mocks.neonThrows = true
    const message = forwardableFixture()

    await worker.email(message, env, fakeCtx())

    expect(message.forward).toHaveBeenCalledTimes(1)
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('supersecretpassword')
    expect(logged).toContain('store_failed')
  })

  it('redacts the connection string from arbitrary store errors', async () => {
    mocks.sql = Object.assign(
      () => Promise.reject(new Error(`cannot reach ${env.DATABASE_URL}`)),
      { transaction: () => Promise.resolve([]) },
    )
    const message = forwardableFixture()

    await worker.email(message, env, fakeCtx())

    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('supersecretpassword')
    expect(logged).toContain('[redacted]')
  })

  it('hands a budget-exceeding store to ctx.waitUntil instead of cancelling it', async () => {
    vi.useFakeTimers()
    mocks.sql = Object.assign(() => new Promise(() => {}), { transaction: () => new Promise(() => {}) })
    const message = forwardableFixture()
    const ctx = fakeCtx()

    const done = worker.email(message, env, ctx)
    await vi.advanceTimersByTimeAsync(5001)
    await done

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('lets forward() failures propagate for MTA retry', async () => {
    mocks.sql = createMockSql({ lookupRows: [LOOKUP_ROW] }).sql
    const message = forwardableFixture()
    message.forward = vi.fn().mockRejectedValue(new Error('destination address not verified'))

    await expect(worker.email(message, env, fakeCtx())).rejects.toThrow('destination address not verified')
  })
})
