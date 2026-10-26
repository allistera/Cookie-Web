// The Auth0 ID token that Supabase reads the `role` claim from. Auth0 strips
// non-namespaced claims from access tokens, so the access token cannot carry
// it. The ID token can expire before the access token, so a token close to
// expiry is renewed first. This lives in its own module, imported on first use
// by supabase.js, so the entry chunk stays within its bundle budget.
const RENEW_BEFORE_MS = 60 * 1000

// Reads `exp` from the payload. The signature is not checked here, because
// Supabase verifies the token when the socket authenticates.
function expiresAt(idToken) {
  const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(payload)).exp * 1000
}

export async function currentIdToken(auth0) {
  let tokens = await auth0.getAccessTokenSilently({ detailedResponse: true })
  if (!tokens?.id_token || expiresAt(tokens.id_token) - Date.now() < RENEW_BEFORE_MS) {
    tokens = await auth0.getAccessTokenSilently({ detailedResponse: true, cacheMode: 'off' })
  }
  if (!tokens?.id_token) throw new Error('Missing ID token')
  return tokens.id_token
}
