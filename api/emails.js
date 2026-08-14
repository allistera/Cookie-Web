import { createServices } from './_lib/services.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const CURSOR_RE = /^(.+)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

// Keyset pagination on (sent_at, id) DESC. The cursor is "<sent_at>|<id>" of
// the last row of the previous page — stable under concurrent inserts, unlike
// OFFSET. fetch one extra row to learn whether another page exists.
// folder selects inbox, sent/outbox, high-confidence AI spam, snoozed, or
// archived (Done) mail. Recipients let the client render "To: <address>" for
// outbound rows.
// Message bodies are deliberately excluded: list rows render the stored snippet,
// while the authoritative body is fetched only when the reader opens.
export function fetchEmails(sql, userId, limit, cursor, folder) {
  return sql`
    SELECT m.id, m.from_name, m.from_address,
           CASE WHEN jsonb_typeof(m.recipients) = 'string'
                THEN (m.recipients #>> '{}')::jsonb
                ELSE m.recipients END AS recipients,
           m.subject, m.snippet,
           m.sent_at, m.is_unread, m.is_starred,
           m.is_sent, m.scheduled_for, ai.spam_score,
           BOOL_OR(NULLIF(BTRIM(ai.summary), '') IS NOT NULL) AS has_ai_summary,
           (m.body_html IS NOT NULL) AS has_html,
           EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments,
           COALESCE(
             json_agg(json_build_object('name', l.name, 'color', l.color, 'kind', l.kind)
                      ORDER BY l.name)
               FILTER (WHERE l.id IS NOT NULL),
             '[]'
           ) AS labels
    FROM messages m
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    LEFT JOIN message_labels ml ON ml.message_id = m.id
    LEFT JOIN labels l ON l.id = ml.label_id
    WHERE m.user_id = ${userId}
      AND NOT m.is_deleted
      AND (
        (${folder} = 'done' AND m.is_archived)
        OR (NOT m.is_archived AND (
          (${folder} = 'sent' AND m.is_sent)
          OR (${folder} = 'spam' AND NOT m.is_sent AND ai.spam_verdict = 'spam')
          OR (${folder} = 'snoozed' AND NOT m.is_sent
              AND COALESCE(ai.spam_verdict, 'inbox') <> 'spam'
              AND m.scheduled_for > now())
          OR (${folder} = 'inbox' AND NOT m.is_sent
              AND COALESCE(ai.spam_verdict, 'inbox') <> 'spam'
              AND (m.scheduled_for IS NULL OR m.scheduled_for <= now()))
        ))
      )
      ${cursor ? sql`AND (m.sent_at, m.id) < (${cursor.sentAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
    GROUP BY m.id, ai.spam_score
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT ${limit + 1}
  `
}

// A bare aggregate (no GROUP BY) always returns exactly one row, even when
// zero messages match, so this no longer needs to anchor on users the way it
// did when it was also the source of the caller's userId (the caller already
// has it from verifyAccessToken). is_unread stays in the WHERE, matching the
// partial index messages_unread_idx (migration 0001).
export function fetchUnreadCount(sql, userId) {
  return sql`
    SELECT count(m.id) FILTER (
             WHERE COALESCE(ai.spam_verdict, 'inbox') <> 'spam'
           )::int AS unread
    FROM messages m
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    WHERE m.user_id = ${userId} AND m.is_unread
      AND NOT m.is_archived AND NOT m.is_sent AND NOT m.is_deleted
      AND (m.scheduled_for IS NULL OR m.scheduled_for <= now())
  `
}

// GET /api/emails?limit=50&before=<sent_at>|<id>&folder=inbox|sent|spam|snoozed|done
// returns the authenticated user's selected folder (inbox by default), newest first. Responds
// {emails, nextCursor, unreadCount, userId}; nextCursor is null on the last
// page. unreadCount always covers the inbox (sent mail is never unread).
// userId lets the client subscribe to its Realtime inbox-ping channel.
export function createHandler(overrides = {}) {
  const services = createServices(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')

    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    const url = new URL(req.url, 'http://localhost')
    const resource = url.searchParams.get('resource')

    // Lightweight app bootstrap for routes that need the unread badge and
    // Realtime channel identity but do not render the mailbox list.
    if (resource === 'state') {
      try {
        const [userRow] = await fetchUnreadCount(services.getSql(), userId)
        res.statusCode = 200
        res.end(
          JSON.stringify({
            unreadCount: userRow?.unread ?? 0,
            userId,
          }),
        )
      } catch (err) {
        console.error('GET /api/emails?resource=state failed:', err)
        res.statusCode = 500
        res.end(JSON.stringify({ error: 'Failed to load inbox state' }))
      }
      return
    }

    const requestedFolder = url.searchParams.get('folder') || 'inbox'
    const folder = ['inbox', 'sent', 'spam', 'snoozed', 'done'].includes(requestedFolder)
      ? requestedFolder
      : null
    if (!folder) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid folder' }))
      return
    }
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
      const sql = services.getSql()
      // The unread count only matters on a list's first page; the client
      // ignores it on cursor pages, so skip the aggregate there.
      const [rows, [userRow]] = await Promise.all([
        fetchEmails(sql, userId, limit, cursor, folder),
        cursor ? [] : fetchUnreadCount(sql, userId),
      ])
      const hasMore = rows.length > limit
      const emails = hasMore ? rows.slice(0, limit) : rows
      const last = emails[emails.length - 1]
      const payload = {
        emails,
        // toISOString keeps millisecond precision; Date's default toString
        // truncates to seconds, which can skip same-second rows on page breaks.
        nextCursor: hasMore ? `${last.sent_at.toISOString()}|${last.id}` : null,
        readReceiptsAvailable: folder === 'sent',
      }
      if (!cursor) {
        payload.unreadCount = userRow?.unread ?? 0
        payload.userId = userId
      }
      res.statusCode = 200
      res.end(JSON.stringify(payload))
    } catch (err) {
      console.error('GET /api/emails failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to load emails' }))
    }
  }
}

export default createHandler()
