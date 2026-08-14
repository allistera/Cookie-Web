import process from 'node:process'

import { Resend } from 'resend'
import { getDownloadUrl, issueSignedToken, presignUrl } from '@vercel/blob'

import { createServices } from './_lib/services.js'
import { readJsonBody } from './_lib/body.js'
import { parseListUnsubscribe, isSafeUnsubscribeUrl } from './_lib/unsubscribe.js'
import { requestPublicHttps } from './_lib/safe-https.js'
import contactsHandler from './_lib/contacts.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNED_URL_TTL_MS = 5 * 60 * 1000

// GET /api/messages?id=<uuid> — the full body of a single message owned by the
// authenticated user, fetched on demand when the reader opens (body_html is
// deliberately excluded from the /api/emails list payload as it can be large
// and untrusted). The saved AI summary is returned alongside the body so the
// reader can restore it without inflating every inbox-list response.
export function fetchOwnedMessageBody(sql, id, email) {
  return sql`
    SELECT m.id, m.thread_id, m.body_html, m.body_text, m.headers, ai.summary
    FROM messages m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    WHERE m.id = ${id} AND lower(u.email) = ${email}
  `
}

// The other messages in this message's conversation (thread_id), oldest
// first, for the reader's collapsed conversation history. Only the summary
// fields are selected — body_html/blob URLs are deliberately left out, same
// as the inbox list, since older thread messages render as plain text.
export function fetchThreadMessages(sql, threadId, email) {
  return sql`
    SELECT m.id, m.from_name, m.from_address, m.snippet, m.sent_at, m.is_sent
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.thread_id = ${threadId} AND lower(u.email) = ${email}
    ORDER BY m.sent_at ASC
  `
}

export function fetchOwnedMessageText(sql, id, email) {
  return sql`
    SELECT m.body_text
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.id = ${id} AND lower(u.email) = ${email}
  `
}

// A message's attachments, ordered by filename. The private Blob URL never
// leaves the server; the client only learns whether the ownership-checked
// attachment download endpoint can issue a short-lived URL.
// messageId ownership is already verified by the caller before this runs.
export function fetchMessageAttachments(sql, messageId) {
  return sql`
    SELECT id, filename, content_type, size_bytes, (blob_url IS NOT NULL) AS downloadable
    FROM attachments
    WHERE message_id = ${messageId}
    ORDER BY filename
  `
}

export function fetchOwnedAttachment(sql, id, email) {
  return sql`
    SELECT a.filename, a.content_type, a.blob_url
    FROM attachments a
    JOIN messages m ON m.id = a.message_id
    JOIN users u ON u.id = m.user_id
    WHERE a.id = ${id} AND lower(u.email) = ${email}
  `
}

export function privateBlobPathname(blobUrl) {
  const url = new URL(blobUrl)
  if (!url.hostname.endsWith('.private.blob.vercel-storage.com')) {
    throw new Error('Attachment does not reference private Blob storage')
  }
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}

async function handleAttachmentGet(req, res, email, services) {
  res.setHeader('Cache-Control', 'private, no-store')

  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (!id || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid attachment id is required' }))
    return
  }

  try {
    const rows = await fetchOwnedAttachment(services.getSql(), id, email)
    const attachment = rows[0]
    if (!attachment?.blob_url) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Attachment is not available' }))
      return
    }

    const pathname = privateBlobPathname(attachment.blob_url)
    const validUntil = Date.now() + SIGNED_URL_TTL_MS
    const signedToken = await services.issueSignedToken({
      pathname,
      operations: ['get'],
      validUntil,
    })
    const { presignedUrl } = await services.presignUrl(signedToken, {
      access: 'private',
      operation: 'get',
      pathname,
      validUntil,
    })

    res.statusCode = 200
    res.end(
      JSON.stringify({
        url: services.getDownloadUrl(presignedUrl),
        filename: attachment.filename || 'attachment',
        contentType: attachment.content_type || 'application/octet-stream',
      }),
    )
  } catch (error) {
    console.error('GET /api/messages?resource=attachment failed:', error)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to prepare attachment download' }))
  }
}

// 404 for a message that is not the caller's (or does not exist), 400 for a
// malformed id.
async function handleGet(req, res, email, services) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (!id || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid message id is required' }))
    return
  }

  try {
    const sql = services.getSql()
    const rows = await fetchOwnedMessageBody(sql, id, email)
    if (rows.length === 0) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }
    // Never return the raw sender-controlled headers to the client; expose only
    // the parsed, safe unsubscribe summary.
    const { headers, thread_id, ...rest } = rows[0]
    const [thread, attachments] = await Promise.all([
      thread_id ? fetchThreadMessages(sql, thread_id, email) : [],
      fetchMessageAttachments(sql, id),
    ])
    res.statusCode = 200
    res.end(
      JSON.stringify({ ...rest, unsubscribe: parseListUnsubscribe(headers), thread, attachments }),
    )
  } catch (err) {
    console.error('GET /api/messages failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load message' }))
  }
}

async function handleThreadBodyGet(req, res, email, services) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (!id || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid message id is required' }))
    return
  }

  try {
    const [message] = await fetchOwnedMessageText(services.getSql(), id, email)
    if (!message) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ body_text: message.body_text ?? '' }))
  } catch (err) {
    console.error('GET /api/messages?resource=thread-body failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load message body' }))
  }
}

// Apply or remove one of the caller's user labels on a message they own. Both
// the message and the label are ownership-checked before the join row changes,
// and the message's full label set is returned so the reader can resync its
// pills. add_label is idempotent (ON CONFLICT DO NOTHING).
async function mutateMessageLabel(res, email, messageId, action, rawLabelId, services) {
  const labelId = UUID_RE.test(rawLabelId) ? String(rawLabelId) : null
  if (!labelId) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid label_id is required' }))
    return
  }

  try {
    const sql = services.getSql()
    // The ownership check exists to report which of message/label is missing
    // (or absent) as a clean 404; the mutation re-scopes the same ownership
    // joins in its own WHERE so it's a safe no-op regardless of that check's
    // outcome, letting the two run concurrently instead of sequentially.
    const ownershipCheck = sql`
      SELECT
        EXISTS (
          SELECT 1 FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.id = ${messageId} AND lower(u.email) = ${email}
        ) AS message,
        EXISTS (
          SELECT 1 FROM labels l JOIN users u ON u.id = l.user_id
          WHERE l.id = ${labelId} AND lower(u.email) = ${email} AND l.kind = 'user'
        ) AS label
    `
    const mutation =
      action === 'add_label'
        ? sql`
            INSERT INTO message_labels (message_id, label_id)
            SELECT ${messageId}, ${labelId}
            WHERE EXISTS (
              SELECT 1 FROM messages m JOIN users u ON u.id = m.user_id
              WHERE m.id = ${messageId} AND lower(u.email) = ${email}
            ) AND EXISTS (
              SELECT 1 FROM labels l JOIN users u ON u.id = l.user_id
              WHERE l.id = ${labelId} AND lower(u.email) = ${email} AND l.kind = 'user'
            )
            ON CONFLICT DO NOTHING
          `
        : sql`
            DELETE FROM message_labels
            WHERE message_id = ${messageId} AND label_id = ${labelId}
              AND EXISTS (
                SELECT 1 FROM messages m JOIN users u ON u.id = m.user_id
                WHERE m.id = ${messageId} AND lower(u.email) = ${email}
              )
          `
    const [[owns]] = await Promise.all([ownershipCheck, mutation])
    if (!owns?.message) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }
    if (!owns?.label) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Label not found' }))
      return
    }

    // Return the same {name, color, kind} shape the list endpoint uses.
    const labels = await sql`
      SELECT l.name, l.color, l.kind
      FROM message_labels ml
      JOIN labels l ON l.id = ml.label_id
      WHERE ml.message_id = ${messageId}
      ORDER BY l.name
    `
    res.statusCode = 200
    res.end(JSON.stringify({ labels }))
  } catch (err) {
    console.error('POST /api/messages label change failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to update labels' }))
  }
}

// POST /api/messages — { id, action: 'unsubscribe' } acts on a message owned by
// the authenticated user. Parses the (untrusted) List-Unsubscribe headers and,
// in preference order: performs a server-side, SSRF-guarded one-click POST;
// sends a mailto unsubscribe via Resend; or returns a safe target for the
// client to open manually. No DB writes.
async function handlePost(req, res, email, services) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const { action } = body
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid id is required' }))
    return
  }

  // Tagging: apply or remove one of the user's labels on the message.
  if (action === 'add_label' || action === 'remove_label') {
    return mutateMessageLabel(res, email, id, action, body.label_id, services)
  }

  if (action !== 'unsubscribe') {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid id and action are required' }))
    return
  }

  try {
    const sql = services.getSql()
    const rows = await sql`
      SELECT m.headers
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.id = ${id} AND lower(u.email) = ${email}
    `
    if (rows.length === 0) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }

    const parsed = parseListUnsubscribe(rows[0].headers)
    if (!parsed) {
      res.statusCode = 422
      res.end(JSON.stringify({ error: 'Message has no unsubscribe information' }))
      return
    }
    const { oneClick, url, mailto } = parsed

    // 1. RFC 8058 one-click: server-side POST, only to an SSRF-safe https URL.
    if (oneClick && url && isSafeUnsubscribeUrl(url)) {
      try {
        const resp = await services.requestPublicHttps(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
          timeoutMs: 10_000,
        })
        if (resp.status < 400) {
          res.statusCode = 200
          res.end(JSON.stringify({ status: 'unsubscribed', method: 'one-click' }))
          return
        }
        console.error('one-click unsubscribe returned status', resp.status)
      } catch (err) {
        console.error('one-click unsubscribe request failed:', err.message)
      }
      // fall through to the fallbacks below on any failure/timeout — never 500.
    }

    // 2. mailto unsubscribe via Resend (when configured).
    if (mailto && process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Allister <me@allisterantosik.com>',
          to: [mailto.address],
          subject: mailto.subject || 'unsubscribe',
          text: 'Please unsubscribe me from this mailing list.',
        })
        if (error) throw new Error(error.message || 'Resend send failed')
        res.statusCode = 200
        res.end(JSON.stringify({ status: 'unsubscribed', method: 'mailto' }))
        return
      } catch (err) {
        console.error('mailto unsubscribe via Resend failed:', err.message)
        // Resend failed — try the link fallback, else 502.
        if (url && isSafeUnsubscribeUrl(url)) {
          res.statusCode = 200
          res.end(JSON.stringify({ status: 'manual', method: 'link', url }))
          return
        }
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Failed to unsubscribe' }))
        return
      }
    }

    // 3. Safe https link for the client to open manually.
    if (url && isSafeUnsubscribeUrl(url)) {
      res.statusCode = 200
      res.end(JSON.stringify({ status: 'manual', method: 'link', url }))
      return
    }

    // 4. mailto with no Resend key: hand the client a mailto: URI to open.
    if (mailto) {
      const mailtoUri =
        'mailto:' +
        mailto.address +
        (mailto.subject ? '?subject=' + encodeURIComponent(mailto.subject) : '')
      res.statusCode = 200
      res.end(JSON.stringify({ status: 'manual', method: 'mailto', mailto: mailtoUri }))
      return
    }

    // 5. Nothing safe/usable (e.g. only an unsafe URL).
    res.statusCode = 422
    res.end(JSON.stringify({ error: 'No safe unsubscribe method is available' }))
  } catch (err) {
    console.error('POST /api/messages failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to unsubscribe' }))
  }
}

// GET returns a single message body (plus a parsed unsubscribe summary); POST
// acts on the unsubscribe or applies/removes a label (action: 'add_label' |
// 'remove_label' with a label_id); PATCH updates flags (is_unread, is_starred,
// is_archived, scheduled_for) on a message owned by the authenticated user.
export function createHandler(overrides = {}) {
  const services = createServices({
    requestPublicHttps,
    issueSignedToken,
    presignUrl,
    getDownloadUrl,
    ...overrides,
  })
  return async function handler(req, res) {
    const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')
    if (resource === 'contacts') {
      await contactsHandler(req, res)
      return
    }

    res.setHeader('Content-Type', 'application/json')

    if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    let email
    try {
      ;({ email } = await services.verifyAccessToken(req))
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    if (req.method === 'GET' && resource === 'attachment') {
      return handleAttachmentGet(req, res, email, services)
    }

    if (req.method === 'GET' && resource === 'thread-body') {
      return handleThreadBodyGet(req, res, email, services)
    }

    if (req.method === 'GET') {
      return handleGet(req, res, email, services)
    }

    if (req.method === 'POST') {
      return handlePost(req, res, email, services)
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      return
    }

    const { is_unread, is_starred, is_archived, is_deleted } = body
    const flags = [is_unread, is_starred, is_archived, is_deleted]
    const id = UUID_RE.test(body.id) ? String(body.id) : null
    const flagsValid = flags.every((f) => f === undefined || f === true || f === false)
    const hasScheduledChange = Object.hasOwn(body, 'scheduled_for')
    const scheduledFor =
      hasScheduledChange && body.scheduled_for !== null ? String(body.scheduled_for ?? '') : null
    const scheduledForValid =
      !hasScheduledChange ||
      scheduledFor === null ||
      Number.isFinite(Date.parse(scheduledFor))
    const hasChange = flags.some((f) => f === true || f === false) || hasScheduledChange
    if (!id || !flagsValid || !scheduledForValid || !hasChange) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'id and at least one valid change are required' }))
      return
    }

    try {
      const sql = services.getSql()
      const rows = await sql`
        UPDATE messages m SET
          is_unread   = COALESCE(${is_unread ?? null}::boolean, m.is_unread),
          is_starred  = COALESCE(${is_starred ?? null}::boolean, m.is_starred),
          is_archived = COALESCE(${is_archived ?? null}::boolean, m.is_archived),
          is_deleted  = COALESCE(${is_deleted ?? null}::boolean, m.is_deleted),
          scheduled_for = CASE
            WHEN ${hasScheduledChange}::boolean THEN ${scheduledFor}::timestamptz
            ELSE m.scheduled_for
          END
        FROM users u
        WHERE m.id = ${id} AND m.user_id = u.id AND lower(u.email) = ${email}
        RETURNING m.id, m.is_unread, m.is_starred, m.is_archived, m.is_deleted, m.scheduled_for
      `
      if (rows.length === 0) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Message not found' }))
        return
      }
      res.statusCode = 200
      res.end(JSON.stringify({ message: rows[0] }))
    } catch (err) {
      console.error('PATCH /api/messages failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to update message' }))
    }
  }
}

export default createHandler()
