import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuth0Client } from '../../auth0-client'
import { authHeaders } from '../authHeaders'

// The redirect latch is keyed on the client, so a fresh stub per test is all
// the isolation these need — no module reset, and no re-importing auth0-vue.
function withClient(client = null) {
  setAuth0Client(client)
  return { authHeaders }
}

function auth0Stub({ token, error } = {}) {
  return {
    getAccessTokenSilently: vi.fn(async () => {
      if (error) throw error
      return token ?? 'tok'
    }),
    loginWithRedirect: vi.fn(async () => {}),
  }
}

function auth0Error(code, message = 'nope') {
  const error = new Error(message)
  error.error = code
  return error
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('authHeaders', () => {
  it('returns the extra headers untouched when there is no client', async () => {
    const { authHeaders } = withClient()

    await expect(authHeaders({ 'Content-Type': 'application/json' })).resolves.toEqual({
      'Content-Type': 'application/json',
    })
  })

  it('adds a bearer token alongside the extra headers', async () => {
    const { authHeaders } = withClient(auth0Stub({ token: 'abc' }))

    await expect(authHeaders({ 'Content-Type': 'application/json' })).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc',
    })
  })

  // A network blip is worth retrying; the session is still good.
  it('rethrows an ordinary failure without sending anyone to log in', async () => {
    const client = auth0Stub({ error: new Error('network down') })
    const { authHeaders } = withClient(client)

    await expect(authHeaders()).rejects.toThrow('network down')
    expect(client.loginWithRedirect).not.toHaveBeenCalled()
  })

  // This is the state a dead refresh token leaves you in: the cached ID token
  // still says "signed in", so the app renders and every request fails.
  it('sends the user to log in when the refresh token is rejected', async () => {
    const client = auth0Stub({
      error: auth0Error('invalid_grant', 'Unknown or invalid refresh token.'),
    })
    const { authHeaders } = withClient(client)

    await expect(authHeaders()).rejects.toThrow('Unknown or invalid refresh token.')
    expect(client.loginWithRedirect).toHaveBeenCalledTimes(1)
  })

  it.each(['invalid_grant', 'login_required', 'consent_required', 'missing_refresh_token'])(
    'treats %s as a dead session',
    async (code) => {
      const client = auth0Stub({ error: auth0Error(code) })
      const { authHeaders } = withClient(client)

      await expect(authHeaders()).rejects.toThrow('nope')
      expect(client.loginWithRedirect).toHaveBeenCalledTimes(1)
    },
  )

  // auth0-spa-js throws MissingRefreshTokenError with no `error` code.
  it('recognises a dead session from the message when there is no code', async () => {
    const client = auth0Stub({ error: new Error('Missing Refresh Token (audience: x)') })
    const { authHeaders } = withClient(client)

    await expect(authHeaders()).rejects.toThrow('Missing Refresh Token')
    expect(client.loginWithRedirect).toHaveBeenCalledTimes(1)
  })

  // Every store fetches on boot, so a dead session throws several times at
  // once. Four concurrent redirects would fight each other.
  it('redirects once however many calls fail together', async () => {
    const client = auth0Stub({ error: auth0Error('invalid_grant') })
    const { authHeaders } = withClient(client)

    await Promise.allSettled([authHeaders(), authHeaders(), authHeaders(), authHeaders()])

    expect(client.loginWithRedirect).toHaveBeenCalledTimes(1)
  })

  // The rejection still has to reach the caller so its own error path runs.
  it('still rejects when the redirect itself fails', async () => {
    const client = auth0Stub({ error: auth0Error('invalid_grant') })
    client.loginWithRedirect = vi.fn(async () => {
      throw new Error('popup blocked')
    })
    const { authHeaders } = withClient(client)

    // The original Auth0 error surfaces, not the redirect's.
    await expect(authHeaders()).rejects.toThrow('nope')
  })
})
