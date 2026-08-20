import { writeAuthError } from './_lib/auth.js'
import { createServices } from './_lib/services.js'
import { readJsonBody } from './_lib/body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function claimNotificationEvent(sql, userId, eventId) {
  return sql`
    UPDATE browser_notification_events event
    SET claim_token = gen_random_uuid(),
        claimed_until = now() + interval '30 seconds'
    FROM messages message
    LEFT JOIN message_ai ai ON ai.message_id = message.id
    WHERE event.event_id = ${eventId}
      AND event.message_id = message.id
      AND event.user_id = ${userId}
      AND message.user_id = ${userId}
      AND (event.claimed_until IS NULL OR event.claimed_until < now())
      AND message.is_unread
      AND NOT message.is_sent
      AND NOT message.is_archived
      AND NOT message.is_deleted
      AND (message.scheduled_for IS NULL OR message.scheduled_for <= now())
      AND COALESCE(ai.spam_verdict, 'inbox') <> 'spam'
    RETURNING event.event_id, event.claim_token, event.claimed_until,
              message.id AS message_id, message.from_name,
              message.from_address, message.subject
  `
}

export function findNotificationEventLease(sql, userId, eventId) {
  return sql`
    SELECT event.claimed_until
    FROM browser_notification_events event
    WHERE event.event_id = ${eventId}
      AND event.user_id = ${userId}
  `
}

export function acknowledgeNotificationEvent(sql, userId, eventId, claimToken) {
  return sql`
    DELETE FROM browser_notification_events event
    WHERE event.event_id = ${eventId}
      AND event.claim_token = ${claimToken}
      AND event.user_id = ${userId}
    RETURNING event.event_id
  `
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.end(body === null ? '' : JSON.stringify(body))
}

export function createHandler(overrides = {}) {
  const services = createServices(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch (error) {
      writeAuthError(res, error)
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }
    if (!['claim', 'ack'].includes(body.action) || !UUID_RE.test(body.eventId || '')) {
      sendJson(res, 400, { error: 'A valid action and event id are required' })
      return
    }
    if (body.action === 'ack' && !UUID_RE.test(body.claimToken || '')) {
      sendJson(res, 400, { error: 'A valid claim token is required' })
      return
    }

    try {
      const sql = services.getSql()
      if (body.action === 'ack') {
        await acknowledgeNotificationEvent(sql, userId, body.eventId, body.claimToken)
        sendJson(res, 204, null)
        return
      }

      const [claimed] = await claimNotificationEvent(sql, userId, body.eventId)
      if (!claimed) {
        const [event] = await findNotificationEventLease(sql, userId, body.eventId)
        if (event?.claimed_until && new Date(event.claimed_until) > new Date()) {
          res.setHeader('Retry-After', '30')
          sendJson(res, 423, { error: 'Notification event is already claimed' })
        } else {
          sendJson(res, 204, null)
        }
        return
      }

      sendJson(res, 200, {
        eventId: claimed.event_id,
        claimToken: claimed.claim_token,
        message: {
          id: claimed.message_id,
          sender: claimed.from_name || claimed.from_address,
          subject: claimed.subject,
        },
      })
    } catch (error) {
      console.error('POST /api/notification-event failed:', error)
      sendJson(res, 500, { error: 'Browser notification event failed' })
    }
  }
}

export default createHandler()
