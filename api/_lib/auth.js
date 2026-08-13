import process from 'node:process'

import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getSql } from './db.js'

const jwksByIssuer = new Map()

// Validates the request's Bearer token against the Auth0 tenant's JWKS.
// Resolves the verified issuer + subject to a provisioned local user. Email
// claims are deliberately ignored: they are mutable profile data and must not
// decide which mailbox an access token can read.
export async function verifyAccessToken(req, overrides = {}) {
  const domain = process.env.VITE_AUTH0_DOMAIN
  const audience = process.env.VITE_AUTH0_AUDIENCE
  if (!domain || !audience) {
    throw new Error('VITE_AUTH0_DOMAIN and VITE_AUTH0_AUDIENCE must be set')
  }

  const [scheme, token] = (req.headers.authorization || '').split(' ')
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Missing bearer token')
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
  const { payload } = await verifyJwt(token, keySet, {
    issuer,
    audience,
    algorithms: ['RS256'],
    clockTolerance: 5,
  })

  const subject = String(payload.sub ?? '').trim()
  if (!subject) {
    throw new Error('Access token has no subject')
  }

  const sql = overrides.sql ?? getSql()
  const [user] = await sql`
    SELECT id, lower(email) AS email
    FROM users
    WHERE auth0_sub = ${subject}
    LIMIT 1
  `
  if (!user?.id || !user?.email) {
    throw new Error('Access token subject is not provisioned')
  }

  return { ...payload, sub: subject, userId: user.id, email: user.email }
}
