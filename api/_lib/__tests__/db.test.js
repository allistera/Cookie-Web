import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('database connection pool', () => {
  it('reads configuration lazily and reuses a pool that supports transaction-mode poolers', async () => {
    const { getSql } = await import('../db.js')
    vi.stubEnv('DATABASE_URL', 'postgres://test.invalid/cookie-test')
    const pool = getSql()
    expect(getSql()).toBe(pool)
    expect(pool.options).toMatchObject({
      host: ['test.invalid'],
      database: 'cookie-test',
      ssl: 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    })
    await pool.end()
  })
})
