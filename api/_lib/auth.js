import process from 'node:process'

import { createRemoteJWKSet, jwtVerify } from 'jose'

let jwks

// Validates the request's Bearer token against the Auth0 tenant's JWKS.
// Returns the token payload; throws on any missing/invalid credential.
export async function verifyAccessToken(req) {
  const domain = process.env.VITE_AUTH0_DOMAIN
  const audience = process.env.VITE_AUTH0_AUDIENCE
  if (!domain || !audience) {
    throw new Error('VITE_AUTH0_DOMAIN and VITE_AUTH0_AUDIENCE must be set')
  }

  const [scheme, token] = (req.headers.authorization || '').split(' ')
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Missing bearer token')
  }

  jwks ??= createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://${domain}/`,
    audience,
    algorithms: ['RS256'],
    clockTolerance: 5,
  })
  return payload
}
