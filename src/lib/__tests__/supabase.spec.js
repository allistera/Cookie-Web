import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('realtime client', () => {
  it.each([
    ['', ''],
    ['https://example.supabase.co', ''],
    ['', 'test-key'],
  ])('disables realtime without both configuration values (%s)', async (url, key) => {
    vi.stubEnv('VITE_SUPABASE_URL', url)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', key)
    const { getRealtimeClient } = await import('../supabase')
    expect(await getRealtimeClient()).toBeNull()
  })

  it.each([
    ['https://example.supabase.co', 'wss://example.supabase.co/realtime/v1/websocket'],
    ['http://localhost:54321', 'ws://localhost:54321/realtime/v1/websocket'],
  ])('creates and reuses one client for %s', async (url, websocketUrl) => {
    vi.stubEnv('VITE_SUPABASE_URL', url)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
    const { getRealtimeClient } = await import('../supabase')
    const first = getRealtimeClient()
    const second = getRealtimeClient()
    expect(first).toBe(second)
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    const endpoint = new URL(a.endpointURL())
    expect(`${endpoint.origin}${endpoint.pathname}`).toBe(websocketUrl)
    expect(endpoint.searchParams.get('apikey')).toBe('test-key')
    expect(a.isConnected()).toBe(false)
    await a.disconnect()
  })

  it('authenticates the socket with the Auth0 token and never redirects to login', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
    const { setAuth0Client } = await import('../../auth0-client')
    const { getRealtimeClient, realtimeAccessToken } = await import('../supabase')
    const loginWithRedirect = vi.fn()

    setAuth0Client({
      getAccessTokenSilently: vi.fn().mockResolvedValue('token-1'),
      loginWithRedirect,
    })
    await expect(realtimeAccessToken()).resolves.toBe('token-1')

    setAuth0Client({
      getAccessTokenSilently: vi.fn().mockRejectedValue(new Error('login_required')),
      loginWithRedirect,
    })
    await expect(realtimeAccessToken()).rejects.toThrow('login_required')
    expect(loginWithRedirect).not.toHaveBeenCalled()

    setAuth0Client(null)
    await expect(realtimeAccessToken()).rejects.toThrow('Auth0 is not configured')

    const client = await getRealtimeClient()
    expect(client.accessToken).toBe(realtimeAccessToken)
    await client.disconnect()
  })
})
