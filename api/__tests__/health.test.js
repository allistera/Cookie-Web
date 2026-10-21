import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHandler } from '../health.js'
import { createHealthChecks, HEALTH_TIMEOUT_MS, runHealthChecks } from '../_lib/health.js'
import { responseRecorder } from './sendTestResponse.js'

afterEach(() => vi.useRealTimers())

describe('GET /api/health', () => {
  it('returns fresh readiness status when every dependency succeeds', async () => {
    const database = vi.fn(async () => {})
    const res = responseRecorder()
    await createHandler({ checks: { database } })({ method: 'GET' }, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', checks: { database: { status: 'ok' } } })
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(database).toHaveBeenCalledOnce()
  })
  it('returns 503 without leaking dependency errors', async () => {
    const res = responseRecorder()
    await createHandler({
      checks: {
        database: async () => {
          throw new Error('postgres://private:secret@database')
        },
        tasks: async () => {},
      },
    })({ method: 'GET' }, res)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body)).toEqual({
      status: 'degraded',
      checks: { database: { status: 'error' }, tasks: { status: 'ok' } },
    })
    expect(res.body).not.toContain('secret')
  })
  it('supports HEAD with the same readiness status and no body', async () => {
    const res = responseRecorder()
    await createHandler({
      checks: {
        database: async () => {
          throw new Error('down')
        },
      },
    })({ method: 'HEAD' }, res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toBeUndefined()
  })
  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('rejects %s without probing', async (method) => {
    const database = vi.fn()
    const res = responseRecorder()
    await createHandler({ checks: { database } })({ method }, res)
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET, HEAD')
    expect(database).not.toHaveBeenCalled()
  })
  it('runs checks concurrently and bounds stalled headers or bodies', async () => {
    vi.useFakeTimers()
    const signals = []
    const hanging = vi.fn((signal) => {
      signals.push(signal)
      return new Promise(() => {})
    })
    const pending = runHealthChecks({ search: hanging, tasks: hanging, database: async () => {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(hanging).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS)
    expect(await pending).toEqual({
      status: 'degraded',
      checks: {
        search: { status: 'error' },
        tasks: { status: 'error' },
        database: { status: 'ok' },
      },
    })
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('production health probes', () => {
  it('uses read-only SQL and all fixed backend health URLs without credentials', async () => {
    const sql = vi.fn(async () => [{ '?column?': 1 }])
    const send = vi.fn(async (url) =>
      Response.json({ status: String(url).includes('meilisearch') ? 'available' : 'ok' }),
    )
    const checks = createHealthChecks({
      fetch: send,
      getSql: () => sql,
      env: { DATABASE_URL: 'configured' },
    })
    const result = await runHealthChecks(checks)
    expect(result.status).toBe('ok')
    expect(Object.keys(result.checks)).toHaveLength(14)
    expect(sql.mock.calls[0][0].join('')).toBe('SELECT 1')
    expect(send).toHaveBeenCalledTimes(13)
    for (const [url, options] of send.mock.calls) {
      expect(new URL(url).pathname).toBe('/health')
      expect(options).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' })
      expect(options.headers).toBeUndefined()
    }
  })
  it('reports a missing database setting without attempting a connection', async () => {
    const getSql = vi.fn()
    const { database } = createHealthChecks({ getSql, env: {} })
    expect((await runHealthChecks({ database })).status).toBe('degraded')
    expect(getSql).not.toHaveBeenCalled()
  })
  it('cancels a database probe when its deadline expires', async () => {
    vi.useFakeTimers()
    const query = Object.assign(new Promise(() => {}), { cancel: vi.fn() })
    const { database } = createHealthChecks({
      getSql: () => () => query,
      env: { DATABASE_URL: 'configured' },
    })
    const pending = runHealthChecks({ database })
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS)
    expect((await pending).status).toBe('degraded')
    expect(query.cancel).toHaveBeenCalledOnce()
  })
  it.each([
    async () => new Response('private upstream details', { status: 503 }),
    async () => Response.json({ status: 'unavailable' }),
    async () => new Response('<html>not a health response</html>'),
    async () => {
      throw new Error('private connection details')
    },
  ])('rejects unhealthy and invalid HTTP probe responses', async (send) => {
    const { search } = createHealthChecks({ fetch: send })
    expect(await runHealthChecks({ search })).toEqual({
      status: 'degraded',
      checks: { search: { status: 'error' } },
    })
  })
  it('bounds a response whose headers arrive but whose JSON body stalls', async () => {
    vi.useFakeTimers()
    const { search } = createHealthChecks({
      fetch: async () => ({ ok: true, json: () => new Promise(() => {}) }),
    })
    const pending = runHealthChecks({ search })
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS)
    expect((await pending).status).toBe('degraded')
  })
})
