import { createAuth0 } from '@auth0/auth0-vue'

// Single Auth0 client shared by main.js (app.use) and the Pinia store
// (access tokens for /api calls). Created lazily on first use; null in E2E
// mode, where auth is stubbed and the local API middleware serves fixtures
// without a token.
const isE2E = import.meta.env.VITE_E2E === 'true'
let client = null
let overridden = false

// Replaces the lazily-created client with an explicit one — tests inject a
// fake token source here (or null for the E2E-style stubbed-auth behavior)
// instead of mocking this module.
export function setAuth0Client(instance) {
  client = instance
  overridden = true
}

export function getAuth0() {
  if (overridden) return client
  if (isE2E) return null
  client ??= createAuth0({
    domain: import.meta.env.VITE_AUTH0_DOMAIN,
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
    // Rotating refresh tokens (persisted to localStorage) let session renewal
    // happen with a direct token request instead of the hidden-iframe silent
    // auth (prompt=none) Auth0 uses by default. That iframe depends on
    // third-party cookies to the Auth0 domain, which Safari/Chrome
    // increasingly block — the fallback is a full top-level /authorize
    // redirect on every page load. Requires the Auth0 API to have "Allow
    // Offline Access" on and the application's Refresh Token grant enabled.
    useRefreshTokens: true,
    cacheLocation: 'localstorage',
    authorizationParams: {
      redirect_uri: window.location.origin,
      audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      scope: 'openid profile email offline_access',
    },
  })
  return client
}
