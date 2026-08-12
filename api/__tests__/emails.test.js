import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../_lib/auth.js', () => ({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
}))
vi.mock('../_lib/sentry.js', () => ({
  captureApiError: vi.fn(async () => undefined),
}))

const rows = []
vi.mock('../_lib/db.js', () => ({
  // Both queries resolve through the same stub; the handler only cares that
  // fetchEmails returns an array of rows.
  getSql: () => () => Promise.resolve(rows),
}))

import handler, { fetchEmails, fetchUnreadCount } from '../emails.js'

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
    expect(res.body).toMatchObject({ emails: [], nextCursor: null, unreadCount: 0, userId: null })
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
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchEmails(sql, 'owner@example.com', 50, null, 'inbox')

    expect(query).toContain('EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments')
  })
})

describe('fetchUnreadCount', () => {
  it('keeps message predicates in the JOIN so the user row survives and the partial unread index applies', () => {
    let query = ''
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchUnreadCount(sql, 'owner@example.com')

    // is_unread must be a join predicate (messages_unread_idx is partial on
    // it), not part of the aggregate FILTER, which would join every message.
    expect(query).toContain('ON m.user_id = u.id AND m.is_unread')
    expect(query).toMatch(/FILTER \(\s*WHERE COALESCE\(ai\.spam_verdict, 'inbox'\) <> 'spam'\s*\)/)
    // No message predicate may leak into the WHERE — that would drop the
    // user's own row (and their userId) when no message matches.
    expect(query).toMatch(/WHERE lower\(u\.email\) =\s*$|WHERE lower\(u\.email\) = \?/)
  })
})
