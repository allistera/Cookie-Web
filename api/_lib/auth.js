import process from 'node:process'

import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getSql } from './db.js'

const jwksByIssuer = new Map()

export class AuthFailure extends Error {
  /**
   * @param {string} message
   * @param {401 | 403 | 503} status
   */
  constructor(message, status) {
    super(message)
    this.name = 'AuthFailure'
    this.status = status
  }
}

export function writeAuthError(res, error) {
  const status = error instanceof AuthFailure ? error.status : 401
  const message =
    status === 503 ? 'Authentication unavailable' : status === 403 ? 'Forbidden' : 'Unauthorized'
  res.statusCode = status
  res.end(JSON.stringify({ error: message }))
}

// Validates the request's Bearer token against the Auth0 tenant's JWKS.
// Resolves the verified issuer + subject to a provisioned local user. Email
// claims are deliberately ignored: they are mutable profile data and must not
// decide which mailbox an access token can read.
export async function verifyAccessToken(req, overrides = {}) {
  const domain = process.env.VITE_AUTH0_DOMAIN
  const audience = process.env.VITE_AUTH0_AUDIENCE
  if (!domain || !audience) {
    throw new AuthFailure('VITE_AUTH0_DOMAIN and VITE_AUTH0_AUDIENCE must be set', 503)
  }

  const [scheme, token] = (req.headers.authorization || '').split(' ')
  if (scheme !== 'Bearer' || !token) {
    throw new AuthFailure('Missing bearer token', 401)
  }

  const issuer = `https://${domain}/`
  let keySet = overrides.jwks
  if (!keySet) {
    keySet = jwksByIssuer.get(issuer)
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`))
      jwksByIssuer.set(issuer, keySet)
    }
  }

  const verifyJwt = overrides.jwtVerify ?? jwtVerify
  let payload
  try {
    ;({ payload } = await verifyJwt(token, keySet, {
      issuer,
      audience,
      algorithms: ['RS256'],
      clockTolerance: 5,
    }))
  } catch {
    throw new AuthFailure('Invalid access token', 401)
  }

  const subject = String(payload.sub ?? '').trim()
  if (!subject) {
    throw new AuthFailure('Access token has no subject', 401)
  }

  const sql = overrides.sql ?? getSql()
  let user
  try {
    ;[user] = await sql`
      SELECT id, lower(email) AS email
      FROM users
      WHERE auth0_sub = ${subject}
      LIMIT 1
    `
  } catch {
    throw new AuthFailure('Mailbox lookup failed', 503)
  }
  if (!user?.id || !user?.email) {
    throw new AuthFailure('Access token subject is not provisioned', 403)
  }

  return { ...payload, sub: subject, userId: user.id, email: user.email }
}
