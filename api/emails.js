import process from 'node:process'

import { neon } from '@neondatabase/serverless'

// GET /api/emails — inbox messages for the reading list, newest first.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  try {
    const sql = neon(process.env.DATABASE_URL)
    const emails = await sql`
      SELECT id, from_name, from_address, subject, snippet, body_text,
             sent_at, is_unread, is_starred
      FROM messages
      WHERE NOT is_archived
      ORDER BY sent_at DESC
    `
    res.statusCode = 200
    res.end(JSON.stringify({ emails }))
  } catch (err) {
    console.error('GET /api/emails failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load emails' }))
  }
}
