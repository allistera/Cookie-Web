import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const CURSOR_RE = /^(.+)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

// Keyset pagination on (sent_at, id) DESC. The cursor is "<sent_at>|<id>" of
// the last row of the previous page — stable under concurrent inserts, unlike
// OFFSET. fetch one extra row to learn whether another page exists.
// folder selects inbox, sent/outbox, high-confidence AI spam, snoozed, or
// archived (Done) mail. Recipients let the client render "To: <address>" for
// outbound rows.
// body_text is truncated to 4 KB: newsletter bodies run tens of KB per row and
// dominated page payloads, while the list only needs enough for the reader's
// instant text render — the authoritative body comes from /api/messages?id=.
export function fetchEmails(sql, email, limit, cursor, folder) {
  return sql`
    SELECT m.id, m.from_name, m.from_address,
           CASE WHEN jsonb_typeof(m.recipients) = 'string'
                THEN (m.recipients #>> '{}')::jsonb
                ELSE m.recipients END AS recipients,
           m.subject,
           m.snippet, LEFT(m.body_text, 4096) AS body_text,
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
    JOIN users u ON u.id = m.user_id
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    LEFT JOIN message_labels ml ON ml.message_id = m.id
    LEFT JOIN labels l ON l.id = ml.label_id
    WHERE lower(u.email) = ${email}
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

// Also returns the user's id (needed by the client to subscribe to their
// Realtime inbox-ping channel) so loading the inbox stays a two-round-trip
// operation instead of three.
// Message predicates live in the LEFT JOIN's ON (never the WHERE): a WHERE
// predicate on m would drop the user's own row when no message matches,
// leaving the client with a null userId and no Realtime subscription.
// is_unread in particular must sit in the ON so the join touches only unread
// rows — matching the partial index messages_unread_idx (migration 0001) —
// instead of materializing the whole non-archived mailbox on every first-page
// load. Only the spam check stays in the FILTER, since it needs the ai join.
export function fetchUnreadCount(sql, email) {
  return sql`
    SELECT u.id AS user_id,
           count(m.id) FILTER (
             WHERE COALESCE(ai.spam_verdict, 'inbox') <> 'spam'
           )::int AS unread
    FROM users u
    LEFT JOIN messages m
      ON m.user_id = u.id AND m.is_unread
      AND NOT m.is_archived AND NOT m.is_sent AND NOT m.is_deleted
      AND (m.scheduled_for IS NULL OR m.scheduled_for <= now())
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    WHERE lower(u.email) = ${email}
    GROUP BY u.id
  `
}

// GET /api/emails?limit=50&before=<sent_at>|<id>&folder=inbox|sent|spam|snoozed|done
// returns the authenticated user's selected folder (inbox by default), newest first. Responds
// {emails, nextCursor, unreadCount, userId}; nextCursor is null on the last
// page. unreadCount always covers the inbox (sent mail is never unread).
// userId lets the client subscribe to its Realtime inbox-ping channel.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const url = new URL(req.url, 'http://localhost')
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
    const sql = getSql()
    // The unread count (and userId) only matter on a list's first page; the
    // client ignores them on cursor pages, so skip the aggregate there.
    const [rows, [userRow]] = await Promise.all([
      fetchEmails(sql, email, limit, cursor, folder),
      cursor ? [] : fetchUnreadCount(sql, email),
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
        readReceiptsAvailable: folder === 'sent',
        ...(cursor ? {} : { unreadCount: userRow?.unread ?? 0, userId: userRow?.user_id ?? null }),
      }),
    )
  } catch (err) {
    console.error('GET /api/emails failed:', err)
    await captureApiError(err, { route: 'GET /api/emails' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load emails' }))
  }
}
