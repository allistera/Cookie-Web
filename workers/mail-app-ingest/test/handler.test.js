import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockSql, fakeMessage, readFixture } from './helpers.js'

const mocks = vi.hoisted(() => ({ sql: null }))

vi.mock('@neondatabase/serverless', () => ({
  neon: () => mocks.sql,
}))

const { default: worker } = await import('../src/index.js')

const env = {
  DATABASE_URL: 'postgresql://placeholder',
  OWNER_EMAIL: 'owner@example.com',
  FORWARD_TO: 'forward@example.com',
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

    await worker.email(message, env, {})

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

    await worker.email(message, env, {})

    expect(message.forward).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('store_failed'))
  })

  it('still forwards when the store step hangs past the budget', async () => {
    vi.useFakeTimers()
    mocks.sql = Object.assign(() => new Promise(() => {}), { transaction: () => new Promise(() => {}) })
    const message = forwardableFixture()

    const done = worker.email(message, env, {})
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

    await worker.email(message, env, {})

    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('Hello from the simple fixture')
  })

  it('lets forward() failures propagate for MTA retry', async () => {
    mocks.sql = createMockSql({ lookupRows: [LOOKUP_ROW] }).sql
    const message = forwardableFixture()
    message.forward = vi.fn().mockRejectedValue(new Error('destination address not verified'))

    await expect(worker.email(message, env, {})).rejects.toThrow('destination address not verified')
  })
})
