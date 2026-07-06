import process from 'node:process'

import { neon } from '@neondatabase/serverless'

import { verifyAccessToken } from './_lib/auth.js'

function fetchEmails(sql, sub) {
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
    WHERE u.auth0_sub = ${sub} AND NOT m.is_archived
    GROUP BY m.id
    ORDER BY m.sent_at DESC
  `
}

// GET /api/emails — the authenticated user's inbox, newest first.
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

  try {
    const sql = neon(process.env.DATABASE_URL)
    const emails = await fetchEmails(sql, sub)
    res.statusCode = 200
    res.end(JSON.stringify({ emails }))
  } catch (err) {
    console.error('GET /api/emails failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load emails' }))
  }
}
