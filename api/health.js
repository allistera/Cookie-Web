import { createHealthChecks, runHealthChecks } from './_lib/health.js'

// The endpoint is public, and each run probes every Worker and the database,
// so one run's result answers every request for the next 30 seconds
// (requests that arrive while it runs wait for it). The cache lives in the
// function instance's memory.
export const HEALTH_CACHE_MS = 30_000

export function createHandler(overrides = {}) {
  const checks = overrides.checks ?? createHealthChecks(overrides)
  const now = overrides.now ?? Date.now
  let cached = null
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    if (!cached || now() - cached.startedAt >= HEALTH_CACHE_MS) {
      cached = { startedAt: now(), result: runHealthChecks(checks) }
    }
    const result = await cached.result
    res.statusCode = result.status === 'ok' ? 200 : 503
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result))
  }
}

export default createHandler()
