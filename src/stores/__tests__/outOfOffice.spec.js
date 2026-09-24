import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAuth0Client } from '../../auth0-client'
import { useOutOfOfficeStore } from '../outOfOffice'
import { outOfOfficeDefaults, outOfOfficeError, outOfOfficeStatus } from '../../lib/outOfOffice'

const document = {
  ...outOfOfficeDefaults(),
  revision: 1,
  enabled: true,
  startDate: '2026-10-25',
  endDate: '2026-10-25',
  timeZone: 'Europe/London',
  text: 'I am away.',
}
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
let store
beforeEach(() => {
  setActivePinia(createPinia())
  setAuth0Client({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-token') })
  store = useOutOfOfficeStore()
  store.setOwner('account-a')
})
afterEach(() => {
  vi.unstubAllGlobals()
  setAuth0Client(null)
})

describe('out-of-office client state', () => {
  it('loads owner settings and sends reviewed fields with the server revision', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(document))
      .mockResolvedValueOnce(response({ ...document, revision: 2, text: 'Back tomorrow.' }))
    vi.stubGlobal('fetch', fetcher)
    await store.load()
    expect(await store.save({ ...document, text: 'Back tomorrow.' })).toBe(true)
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      revision: 1,
      text: 'Back tomorrow.',
    })
    expect(store.document.revision).toBe(2)
  })
  it('preserves unsaved content and prevents blind overwrite after a conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(document))
        .mockResolvedValueOnce(response({ current: { ...document, revision: 2 } }, 409)),
    )
    await store.load()
    const draft = { ...document, text: 'My draft' }
    expect(await store.save(draft)).toBe(false)
    expect(store.conflict).toBe(true)
    expect(draft.text).toBe('My draft')
    expect(await store.save(draft)).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('does not upgrade an unsaved draft revision when background polling observes another save', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(document))
      .mockResolvedValueOnce(response({ ...document, revision: 2, text: 'Another browser' }))
    vi.stubGlobal('fetch', fetcher)
    await store.load()
    const draft = { ...document, text: 'My older draft' }
    await store.load({ force: true })
    expect(await store.save(draft)).toBe(false)
    expect(store.conflict).toBe(true)
    expect(store.document.text).toBe('Another browser')
    expect(draft.text).toBe('My older draft')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('reports a failed refresh without replacing the previous settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(response(document)).mockRejectedValueOnce(new Error('offline')),
    )
    await store.load()
    expect(await store.load({ force: true })).toBe(false)
    expect(store.document).toEqual(document)
    expect(store.error).toContain('outdated')
  })
  it('drops a prior account response and clears reply content on logout', async () => {
    let finish
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(response(outOfOfficeDefaults())),
    )
    const old = store.load()
    await Promise.resolve()
    await Promise.resolve()
    store.setOwner('account-b')
    await store.load()
    finish(response(document))
    await old
    expect(store.document.enabled).toBe(false)
    expect(store.document.text).toBe('')
    store.setOwner(null)
    expect(store.loaded).toBe(false)
  })
  it('End now targets the latest server revision and manual resolution never sends a message', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(outOfOfficeDefaults()))
    vi.stubGlobal('fetch', fetcher)
    await store.stop()
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: 'stop' })
    await store.resolve('delivery', 'not_delivered')
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      action: 'resolve',
      deliveryId: 'delivery',
      outcome: 'not_delivered',
    })
  })
})

describe('client date boundaries and preview validation', () => {
  it('shows scheduled, active and expired including the repeated DST hour', () => {
    expect(outOfOfficeStatus(document, '2026-10-24T22:59:59Z')).toBe('scheduled')
    expect(outOfOfficeStatus(document, '2026-10-25T00:30:00Z')).toBe('active')
    expect(outOfOfficeStatus(document, '2026-10-25T01:30:00Z')).toBe('active')
    expect(outOfOfficeStatus(document, '2026-10-26T00:00:00Z')).toBe('expired')
    expect(outOfOfficeStatus({ ...document, enabled: false })).toBe('disabled')
  })
  it('rejects impossible dates and injected headers while leaving markup literal in the body', () => {
    expect(outOfOfficeError({ ...document, startDate: '2026-02-30' })).toContain('real')
    expect(outOfOfficeError({ ...document, subject: 'Away\r\nBcc: bad@example.com' })).toContain(
      'control',
    )
    expect(outOfOfficeError({ ...document, text: '<script>alert(1)</script>' })).toBe('')
  })
})
