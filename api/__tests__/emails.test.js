import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler, fetchEmails, fetchUnreadCount } from '../emails.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const rows = []

const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
  // Both queries resolve through the same stub; the handler only cares that
  // fetchEmails returns an array of rows.
  getSql: () => () => Promise.resolve(rows),
})

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(payload) {
      this.body = JSON.parse(payload)
    },
  }
}

describe('GET /api/emails handler', () => {
  beforeEach(() => {
    rows.length = 0
  })

  it('returns the first page with unread count and userId', async () => {
    const res = makeRes()
    await handler({ method: 'GET', url: '/api/emails?limit=50', headers: {} }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ emails: [], nextCursor: null, unreadCount: 0, userId: USER_ID })
  })

  it('returns lightweight inbox state without a message list', async () => {
    rows.push({ unread: 7 })
    const res = makeRes()

    await handler({ method: 'GET', url: '/api/emails?resource=state', headers: {} }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      unreadCount: 7,
      userId: USER_ID,
    })
    expect(res.body).not.toHaveProperty('emails')
  })

  it('returns cursor pages without the unread aggregate instead of crashing', async () => {
    const res = makeRes()
    const before = encodeURIComponent(
      '2026-07-01T00:00:00.000Z|11111111-1111-1111-1111-111111111111',
    )
    await handler({ method: 'GET', url: `/api/emails?limit=50&before=${before}`, headers: {} }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ emails: [], nextCursor: null })
    expect(res.body).not.toHaveProperty('unreadCount')
    expect(res.body).not.toHaveProperty('userId')
  })
})

describe('fetchEmails', () => {
  it('includes a has_attachments flag scoped to each message', () => {
    let query = ''
    const sql = (strings, ...values) => {
      query = strings.reduce((acc, part, i) => {
        if (i === 0) return part
        const value = values[i - 1]
        if (value?.__frag) return acc + value.text + part
        return `${acc}?${part}`
      }, '')
      const frag = []
      frag.__frag = true
      frag.text = query
      return frag
    }

    fetchEmails(sql, USER_ID, 50, null, 'inbox')

    expect(query).toContain('EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments')
    expect(query).toContain('WHERE m.user_id = ?')
    expect(query).not.toContain('body_text')
  })
})

describe('fetchUnreadCount', () => {
  it('keeps is_unread in the WHERE so the partial unread index applies', () => {
    let query = ''
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchUnreadCount(sql, USER_ID)

    // messages_unread_idx is a partial index ON messages (user_id) WHERE
    // is_unread — this predicate shape matches it directly.
    expect(query).toContain('WHERE m.user_id = ? AND m.is_unread')
    expect(query).toMatch(/FILTER \(\s*WHERE COALESCE\(ai\.spam_verdict, 'inbox'\) <> 'spam'\s*\)/)
  })
})
