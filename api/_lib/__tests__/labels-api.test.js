import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../../labels.js'

const getSql = vi.fn()
const verifyAccessToken = vi.fn()

const handler = createHandler({
  getSql,
  verifyAccessToken,
})

const LABEL_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '99999999-9999-4999-8999-999999999999'

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
    verifyAccessToken.mockResolvedValue({ email: 'owner@example.com', userId: USER_ID })
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

  it('updates colour and description, including clearing the description', async () => {
    const sql = vi.fn().mockResolvedValue([
      { id: LABEL_ID, name: 'Work', color: '#2F6BE0', kind: 'user', description: null, auto_apply: false },
    ])
    getSql.mockReturnValue(sql)
    const res = response()

    await handler(
      {
        method: 'PATCH',
        body: { id: LABEL_ID, color: '#2F6BE0', description: '', auto_apply: false },
      },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).label).toMatchObject({ color: '#2F6BE0', description: null })
    expect(sql.mock.calls[0].slice(1)).toEqual(expect.arrayContaining([true, '#2F6BE0', null]))
  })

  it.each([
    { color: 'blue' },
    { color: '#12345' },
    { description: 'x'.repeat(201) },
  ])('rejects invalid editable fields before querying the database: %o', async (changes) => {
    const sql = vi.fn()
    getSql.mockReturnValue(sql)
    const res = response()

    await handler({ method: 'PATCH', body: { id: LABEL_ID, ...changes } }, res)

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
