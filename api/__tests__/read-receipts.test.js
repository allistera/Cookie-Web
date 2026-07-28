import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import handler, { fetchOwnedReadReceipts, recordReadReceipt } from '../read-receipts.js'

function captureSql() {
  let query = ''
  let values = []
  const sql = (strings, ...parameters) => {
    query = strings.join('?')
    values = parameters
    return []
  }
  return { sql, query: () => query, values: () => values }
}

describe('read receipt queries', () => {
  it('records first and subsequent opens using only the opaque token', () => {
    const capture = captureSql()
    const token = '11111111-1111-4111-8111-111111111111'

    recordReadReceipt(capture.sql, token)

    expect(capture.query()).toContain('first_opened_at = COALESCE(first_opened_at, now())')
    expect(capture.query()).toContain('open_count = open_count + 1')
    expect(capture.query()).toContain('WHERE token =')
    expect(capture.query()).toContain('expires_at > now()')
    expect(capture.query()).toContain("last_opened_at < now() - interval '5 minutes'")
    expect(capture.values()).toEqual([token])
  })

  it('returns statuses only for messages owned by the authenticated user', () => {
    const capture = captureSql()
    const ids = ['11111111-1111-4111-8111-111111111111']

    fetchOwnedReadReceipts(capture.sql, 'owner@example.com', ids)

    expect(capture.query()).toContain('JOIN users u ON u.id = r.user_id')
    expect(capture.query()).toContain('WHERE lower(u.email) =')
    expect(capture.query()).toContain('r.message_id = ANY')
    expect(capture.values()).toEqual(['owner@example.com', ids])
  })
})

describe('read receipt pixel', () => {
  it('returns the same non-cacheable image for an invalid token without authenticating', async () => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value
      },
      end(body) {
        this.body = body
      },
    }

    await handler({ method: 'GET', url: '/api/read-receipts?token=not-a-token' }, res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('image/gif')
    expect(res.headers['Cache-Control']).toContain('no-store')
    expect(Buffer.isBuffer(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })
})
