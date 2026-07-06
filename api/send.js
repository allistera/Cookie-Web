import process from 'node:process'

import { Resend } from 'resend'

import { verifyAccessToken } from './_lib/auth.js'
import { readJsonBody } from './_lib/body.js'

// POST /api/send — send an email through Resend as the app's mailbox address.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    await verifyAccessToken(req)
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  if (!process.env.RESEND_API_KEY) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is not configured' }))
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const { to, subject, text } = body
  if (
    typeof to !== 'string' || !to.includes('@') ||
    typeof subject !== 'string' || !subject.trim() ||
    typeof text !== 'string' || !text.trim()
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'to, subject and text are required' }))
    return
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Allister <me@allisterantosik.com>',
      to: [to],
      subject,
      text,
    })
    if (error) {
      console.error('Resend send failed:', error)
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'Failed to send email' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ id: data.id }))
  } catch (err) {
    console.error('POST /api/send failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to send email' }))
  }
}
