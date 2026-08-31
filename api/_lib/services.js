import { getSql } from './db.js'
import { verifyAccessToken } from './auth.js'
import { allowRequest } from './rate-limit.js'

// Production wiring for the dependencies every handler shares. Each api/
// module builds its default export with createHandler(), and tests build the
// same handler with fakes passed here — the seam is an ordinary argument, so
// nothing needs module mocking.
export function createServices(overrides = {}) {
  return { getSql, verifyAccessToken, allowRequest, ...overrides }
}
