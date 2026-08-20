import { describe, expect, it, vi } from 'vitest'

import { allowRequest } from '../rate-limit.js'

function sqlReturning(row) {
  return vi.fn((strings, ...values) => {
    sqlReturning.query = strings.join('?')
    sqlReturning.values = values
    return Promise.resolve([row])
  })
}

describe('allowRequest', () => {
  it('claims a shared database counter with one atomic upsert', async () => {
    const sql = sqlReturning({ allowed: true })

    await expect(
      allowRequest(sql, '11111111-1111-4111-8111-111111111111', 'ai', {
        limit: 10,
        windowMs: 60_000,
      }),
    ).resolves.toBe(true)

    expect(sqlReturning.query).toContain('INSERT INTO api_rate_limits')
    expect(sqlReturning.query).toContain('ON CONFLICT (user_id, scope) DO UPDATE')
    expect(sqlReturning.query).toContain('api_rate_limits.request_count <')
    expect(sqlReturning.values).toEqual([
      '11111111-1111-4111-8111-111111111111',
      'ai',
      60_000,
      60_000,
      60_000,
      10,
    ])
  })

  it('rejects when the shared counter cannot be claimed', async () => {
    const sql = sqlReturning({ allowed: false })

    await expect(
      allowRequest(sql, '11111111-1111-4111-8111-111111111111', 'ai', {
        limit: 10,
        windowMs: 60_000,
      }),
    ).resolves.toBe(false)
  })

  it('fails closed on invalid policy values without querying the database', async () => {
    const sql = vi.fn()

    await expect(
      allowRequest(sql, '11111111-1111-4111-8111-111111111111', 'ai', {
        limit: 0,
        windowMs: 60_000,
      }),
    ).rejects.toThrow(/invalid rate-limit policy/i)
    expect(sql).not.toHaveBeenCalled()
  })
})
