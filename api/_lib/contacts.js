import { getSql } from './db.js'
import { verifyAccessToken } from './auth.js'
import { captureApiError } from './sentry.js'

// Autocomplete stays useful well below this; the bound exists so a
// pathological mailbox (mailing-list traffic, scraped inboxes) can't turn
// the response into megabytes. The view has no usage counts to rank by, so
// the cut is alphabetical like the display order.
const MAX_CONTACTS = 2000

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
    LIMIT ${MAX_CONTACTS}
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
    // The contacts view aggregates the whole mailbox per read (jsonb-unnesting
    // every sent message), and autocomplete tolerates staleness — let the
    // browser reuse the response for a few minutes. private: per-user data,
    // must never land in a shared cache.
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.end(JSON.stringify({ contacts: rows.map((r) => ({ address: r.address, name: r.name })) }))
  } catch (err) {
    console.error('GET contacts failed:', err)
    await captureApiError(err, { route: 'GET contacts' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load contacts' }))
  }
}
