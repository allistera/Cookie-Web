import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const CURSOR_RE = /^(.+)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

// Keyset pagination on (sent_at, id) DESC. The cursor is "<sent_at>|<id>" of
// the last row of the previous page — stable under concurrent inserts, unlike
// OFFSET. fetch one extra row to learn whether another page exists.
function fetchEmails(sql, sub, limit, cursor) {
  if (cursor) {
    return sql`
      SELECT m.id, m.from_name, m.from_address, m.subject, m.snippet,
             m.body_text, m.sent_at, m.is_unread, m.is_starred,
             COALESCE(
               json_agg(json_build_object('name', l.name, 'color', l.color)
                        ORDER BY l.name)
                 FILTER (WHERE l.id IS NOT NULL),
               '[]'
             ) AS labels
      FROM messages m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN message_labels ml ON ml.message_id = m.id
      LEFT JOIN labels l ON l.id = ml.label_id
      WHERE u.auth0_sub = ${sub} AND NOT m.is_archived AND NOT m.is_sent
        AND (m.sent_at, m.id) < (${cursor.sentAt}::timestamptz, ${cursor.id}::uuid)
      GROUP BY m.id
      ORDER BY m.sent_at DESC, m.id DESC
      LIMIT ${limit + 1}
    `
  }
  return sql`
    SELECT m.id, m.from_name, m.from_address, m.subject, m.snippet,
           m.body_text, m.sent_at, m.is_unread, m.is_starred,
           COALESCE(
             json_agg(json_build_object('name', l.name, 'color', l.color)
                      ORDER BY l.name)
               FILTER (WHERE l.id IS NOT NULL),
             '[]'
           ) AS labels
    FROM messages m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN message_labels ml ON ml.message_id = m.id
    LEFT JOIN labels l ON l.id = ml.label_id
    WHERE u.auth0_sub = ${sub} AND NOT m.is_archived AND NOT m.is_sent
    GROUP BY m.id
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT ${limit + 1}
  `
}

function fetchUnreadCount(sql, sub) {
  return sql`
    SELECT count(*)::int AS unread
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE u.auth0_sub = ${sub} AND m.is_unread
      AND NOT m.is_archived AND NOT m.is_sent
  `
}

// GET /api/emails?limit=50&before=<sent_at>|<id> — the authenticated user's
// inbox, newest first. Responds {emails, nextCursor, unreadCount}; nextCursor
// is null on the last page. unreadCount covers the whole mailbox, not the page.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  let sub
  try {
    ;({ sub } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const url = new URL(req.url, 'http://localhost')
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  let cursor = null
  const before = url.searchParams.get('before')
  if (before) {
    const match = CURSOR_RE.exec(before)
    if (!match || Number.isNaN(Date.parse(match[1]))) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid before cursor' }))
      return
    }
    cursor = { sentAt: match[1], id: match[2] }
  }

  try {
    const sql = getSql()
    const [rows, [{ unread }]] = await Promise.all([
      fetchEmails(sql, sub, limit, cursor),
      fetchUnreadCount(sql, sub),
    ])
    const hasMore = rows.length > limit
    const emails = hasMore ? rows.slice(0, limit) : rows
    const last = emails[emails.length - 1]
    res.statusCode = 200
    res.end(
      JSON.stringify({
        emails,
        // toISOString keeps millisecond precision; Date's default toString
        // truncates to seconds, which can skip same-second rows on page breaks.
        nextCursor: hasMore ? `${last.sent_at.toISOString()}|${last.id}` : null,
        unreadCount: unread,
      }),
    )
  } catch (err) {
    console.error('GET /api/emails failed:', err)
    await captureApiError(err, { route: 'GET /api/emails' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load emails' }))
  }
}
