import { Buffer } from 'node:buffer'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MESSAGES = 100
// A transparent 1x1 GIF. Receipt requests always return the same image so an
// invalid or expired opaque token reveals nothing about mailbox state.
const PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')

export function recordReadReceipt(sql, token) {
  return sql`
    UPDATE message_read_receipts
    SET first_opened_at = COALESCE(first_opened_at, now()),
        last_opened_at = now(),
        open_count = open_count + 1
    WHERE token = ${token}
  `
}

export function fetchOwnedReadReceipts(sql, email, messageIds) {
  return sql`
    SELECT r.message_id, r.first_opened_at, r.last_opened_at, r.open_count
    FROM message_read_receipts r
    JOIN users u ON u.id = r.user_id
    WHERE lower(u.email) = ${email}
      AND r.message_id = ANY(${messageIds}::uuid[])
  `
}

function sendPixel(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Content-Length', String(PIXEL.length))
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.end(PIXEL)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const url = new URL(req.url, 'http://localhost')
  const token = url.searchParams.get('token')
  if (token !== null) {
    if (UUID_RE.test(token)) {
      try {
        await recordReadReceipt(getSql(), token)
      } catch (err) {
        // Tracking must never affect delivery or leak failures to recipients.
        if (err?.code !== '42P01') {
          await captureApiError(err, { route: 'GET /api/read-receipts (pixel)' })
        }
      }
    }
    sendPixel(res)
    return
  }

  res.setHeader('Content-Type', 'application/json')
  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const rawIds = (url.searchParams.get('messageIds') || '').split(',').filter(Boolean)
  if (
    rawIds.length === 0 ||
    rawIds.length > MAX_MESSAGES ||
    !rawIds.every((id) => UUID_RE.test(id))
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'One to 100 valid messageIds are required' }))
    return
  }

  try {
    const receipts = await fetchOwnedReadReceipts(getSql(), email, rawIds)
    res.statusCode = 200
    res.end(JSON.stringify({ receipts }))
  } catch (err) {
    // During a rolling deploy the new table may not exist yet. Sent mail stays
    // usable and simply shows the conservative, unopened state until it does.
    if (err?.code !== '42P01') {
      await captureApiError(err, { route: 'GET /api/read-receipts (status)' })
    }
    res.statusCode = 200
    res.end(JSON.stringify({ receipts: [] }))
  }
}
