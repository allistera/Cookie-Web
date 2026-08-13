import process from 'node:process'

import { createRemoteJWKSet, jwtVerify } from 'jose'

// User lookups key on the token's email claim rather than `sub`, so logins
// survive Auth0 connection changes (a Google -> database cutover changes the
// sub but not the address). Auth0 access tokens don't carry email by default;
// a post-login Action must copy it into this namespaced custom claim:
//
//   exports.onExecutePostLogin = async (event, api) => {
//     api.accessToken.setCustomClaim('https://cookie-web/email', event.user.email)
//   }
const EMAIL_CLAIM = 'https://cookie-web/email'

let jwks

// Validates the request's Bearer token against the Auth0 tenant's JWKS.
// Returns the token payload with `email` normalized to lowercase; throws on
// any missing/invalid credential or a token without an email claim.
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

  const email = String(payload[EMAIL_CLAIM] ?? payload.email ?? '')
  if (!email) {
    throw new Error('Access token has no email claim')
  }
  return { ...payload, email: email.toLowerCase() }
}
