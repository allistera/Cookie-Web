import { Buffer } from 'node:buffer'

import { getSql } from './_lib/db.js'
import { verifyAccessToken, writeAuthError } from './_lib/auth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MESSAGES = 100
// A transparent 1x1 GIF. Receipt requests always return the same image so an
// invalid or expired opaque token reveals nothing about mailbox state.
const PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')
// Flood guard for the unauthenticated pixel path — the only route that touches
// Postgres without a token. In-memory state is per serverless instance, so it
// bounds how much database load a single instance will generate rather than
// enforcing a global quota; a platform-level WAF rule is the global control.
const PIXEL_WINDOW_MS = 60_000
const PIXEL_MAX_PER_WINDOW = 120
const PIXEL_HITS_PRUNE_SIZE = 10_000
const pixelHits = new Map()

function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (
    String(first ?? '')
      .split(',')[0]
      .trim() || 'unknown'
  )
}

function pixelFlooded(ip) {
  const now = Date.now()
  const entry = pixelHits.get(ip)
  if (!entry || now - entry.windowStart >= PIXEL_WINDOW_MS) {
    // Hard cap with O(1) eviction: a flood of fresh spoofed addresses must
    // not grow the map past the cap or trigger full-map scans per request.
    // Entries are kept in window-start order (delete+set moves a recycled
    // window to the back), so the first key is always the oldest window and
    // the most likely to be expired.
    if (!entry && pixelHits.size >= PIXEL_HITS_PRUNE_SIZE) {
      const oldest = pixelHits.keys().next().value
      if (oldest !== undefined) pixelHits.delete(oldest)
    }
    pixelHits.delete(ip)
    pixelHits.set(ip, { windowStart: now, count: 1 })
    return false
  }
  entry.count += 1
  return entry.count > PIXEL_MAX_PER_WINDOW
}

export function recordReadReceipt(sql, token) {
  return sql`
    UPDATE message_read_receipts
    SET first_opened_at = COALESCE(first_opened_at, now()),
        last_opened_at = now(),
        open_count = open_count + 1
    WHERE token = ${token}
      AND expires_at > now()
      AND (
        last_opened_at IS NULL OR
        last_opened_at < now() - interval '5 minutes'
      )
  `
}

export function fetchOwnedReadReceipts(sql, userId, messageIds) {
  return sql`
    SELECT r.message_id, r.first_opened_at, r.last_opened_at, r.open_count
    FROM message_read_receipts r
    WHERE r.user_id = ${userId}
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
    // The pixel response is identical either way, so a flooded client just
    // stops reaching the database — no behavior change to legitimate opens.
    if (UUID_RE.test(token) && !pixelFlooded(clientIp(req))) {
      try {
        await recordReadReceipt(getSql(), token)
      } catch (err) {
        // Tracking must never affect delivery or leak failures to recipients.
        if (err?.code !== '42P01') {
          console.error('GET /api/read-receipts (pixel) failed:', err)
        }
      }
    }
    sendPixel(res)
    return
  }

  res.setHeader('Content-Type', 'application/json')
  let userId
  try {
    ;({ userId } = await verifyAccessToken(req))
  } catch (error) {
    writeAuthError(res, error)
    return
  }

  // Bound the parameter before split() expands it: 100 UUIDs plus commas is
  // 3,699 chars, so anything past 4,000 can't be a valid request.
  const rawParam = url.searchParams.get('messageIds') || ''
  const rawIds = rawParam.length > 4000 ? [] : rawParam.split(',').filter(Boolean)
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
    const receipts = await fetchOwnedReadReceipts(getSql(), userId, rawIds)
    res.statusCode = 200
    res.end(JSON.stringify({ receipts }))
  } catch (err) {
    // During a rolling deploy the new table may not exist yet. Sent mail stays
    // usable and simply shows the conservative, unopened state until it does.
    if (err?.code !== '42P01') {
      console.error('GET /api/read-receipts (status) failed:', err)
    }
    res.statusCode = 200
    res.end(JSON.stringify({ receipts: [] }))
  }
}
