import process from 'node:process'

import { createServices } from './services.js'
import { allowRequest } from './rate-limit.js'

// A triage rebuild is one model call in the Worker, so it is cheap enough to
// offer on demand but not free: cap it well below what a held-down button
// could manage.
export const RATE_LIMIT = { limit: 4, windowMs: 60_000 }

// The Worker's own trigger takes a while (a database round trip plus the model
// call), but not longer than a user will wait behind a spinner.
const TIMEOUT_MS = 30_000

export class EnricherNotConfiguredError extends Error {
  constructor() {
    super('The enricher trigger is not configured')
    this.name = 'EnricherNotConfiguredError'
  }
}

// Ask the data-enricher Worker to rebuild both AI Today cards — mail triage
// and the news round-up — and nothing else. The URL and token come from
// the environment, never from the request, so this is not an SSRF surface and
// needs no safe-https treatment; the token stays server-side so the browser
// never holds a Worker credential.
export async function triggerDigestRebuild() {
  const runUrl = process.env.ENRICHER_RUN_URL
  const token = process.env.ENRICHER_TRIGGER_TOKEN
  if (!runUrl || !token) throw new EnricherNotConfiguredError()

  const url = new URL(runUrl)
  url.searchParams.set('phase', 'today')
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Enricher responded ${response.status}`)
  }
}

// POST /api/tasks?resource=refresh — rebuild AI Today's triage now instead of
// waiting for the Worker's nightly cron. Returns 200 once it has been written,
// so the caller can re-read /api/tasks and see the new priority groups.
export async function handleRefresh(req, res, userId, services = createServices()) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  let allowed
  try {
    allowed = await allowRequest(services.getSql(), userId, 'enricher', RATE_LIMIT)
  } catch (err) {
    console.error('POST /api/tasks?resource=refresh quota enforcement failed:', err.message)
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Refresh is temporarily unavailable' }))
    return
  }
  if (!allowed) {
    res.statusCode = 429
    res.end(JSON.stringify({ error: 'Too many refreshes. Try again shortly.' }))
    return
  }

  try {
    await triggerDigestRebuild()
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true }))
  } catch (err) {
    if (err instanceof EnricherNotConfiguredError) {
      // A deployment without the Worker wired up should say so plainly rather
      // than look like a transient failure the user could retry away.
      res.statusCode = 501
      res.end(JSON.stringify({ error: 'Refresh is not configured for this deployment' }))
      return
    }
    console.error('POST /api/tasks?resource=refresh failed:', err)
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Failed to refresh' }))
  }
}
