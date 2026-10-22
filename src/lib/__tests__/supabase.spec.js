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
})
