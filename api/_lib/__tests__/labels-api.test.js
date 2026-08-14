import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../../labels.js'

const getSql = vi.fn()
const verifyAccessToken = vi.fn()

const handler = createHandler({
  getSql,
  verifyAccessToken,
})

const LABEL_ID = '11111111-1111-1111-1111-111111111111'

function response() {
  return {
    statusCode: 200,
    body: '',
    setHeader: vi.fn(),
    end(body = '') {
      this.body = body
    },
  }
}

describe('PATCH /api/labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyAccessToken.mockResolvedValue({ email: 'owner@example.com' })
  })

  it('trims and persists a renamed user label', async () => {
    const sql = vi.fn().mockResolvedValue([
      { id: LABEL_ID, name: 'Money', color: '#2f9e44', kind: 'user', auto_apply: true },
    ])
    getSql.mockReturnValue(sql)
    const res = response()

    await handler(
      { method: 'PATCH', body: { id: LABEL_ID, name: '  Money  ' } },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).label.name).toBe('Money')
    expect(sql).toHaveBeenCalledOnce()
    expect(sql.mock.calls[0].slice(1)).toContain('Money')
  })

  it('rejects an empty label name before querying the database', async () => {
    const sql = vi.fn()
    getSql.mockReturnValue(sql)
    const res = response()

    await handler({ method: 'PATCH', body: { id: LABEL_ID, name: '   ' } }, res)

    expect(res.statusCode).toBe(400)
    expect(sql).not.toHaveBeenCalled()
  })

  it('returns a conflict when the renamed label already exists', async () => {
    const duplicateError = Object.assign(new Error('duplicate'), { code: '23505' })
    getSql.mockReturnValue(vi.fn().mockRejectedValue(duplicateError))
    const res = response()

    await handler({ method: 'PATCH', body: { id: LABEL_ID, name: 'Home' } }, res)

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toMatch(/already exists/i)
  })
})
