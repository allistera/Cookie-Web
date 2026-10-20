import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeMailSettings } from '../lazyMailSettings'

function settingsStore() {
  return {
    composeOwnerSub: 'a',
    composeGeneration: 1,
    authHeaders: vi.fn().mockResolvedValue({ Authorization: 'test' }),
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('lazy mail settings', () => {
  it('keeps the store context and returns the API result', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ sent: true }))
    vi.stubGlobal('fetch', fetch)
    const store = settingsStore()
    await expect(invokeMailSettings(store, 'sendNtfyTest', [])).resolves.toEqual({ sent: true })
    expect(store.authHeaders).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/ntfy/test'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
  it('does not begin an action after the account changes while loading', async () => {
    const store = settingsStore()
    const pending = invokeMailSettings(store, 'sendNtfyTest', [])
    store.composeOwnerSub = 'b'
    store.composeGeneration++
    expect(await pending).toBeNull()
    expect(store.authHeaders).not.toHaveBeenCalled()
  })
})
