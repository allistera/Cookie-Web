import { getSql } from './db.js'
import { verifyAccessToken } from './auth.js'
import { captureApiError } from './sentry.js'

// The authenticated user's contacts — addresses that appear in their mailbox
// (received senders or sent recipients) — from the contacts view, ordered for
// display.
export function fetchContacts(sql, email) {
  return sql`
    SELECT c.address, c.name
    FROM contacts c
    JOIN users u ON u.id = c.user_id
    WHERE lower(u.email) = ${email}
    ORDER BY c.name NULLS LAST, c.address
  `
}

// GET /api/messages?resource=contacts — compose auto-suggest contacts.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  try {
    const sql = getSql()
    const rows = await fetchContacts(sql, email)
    res.statusCode = 200
    res.end(JSON.stringify({ contacts: rows.map((r) => ({ address: r.address, name: r.name })) }))
  } catch (err) {
    console.error('GET contacts failed:', err)
    await captureApiError(err, { route: 'GET contacts' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load contacts' }))
  }
}
