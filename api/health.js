import { createHealthChecks, runHealthChecks } from './_lib/health.js'

export function createHandler(overrides = {}) {
  const checks = overrides.checks ?? createHealthChecks(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    const result = await runHealthChecks(checks)
    res.statusCode = result.status === 'ok' ? 200 : 503
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result))
  }
}

export default createHandler()
