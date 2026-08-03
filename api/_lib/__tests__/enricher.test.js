import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../sentry.js', () => ({
  captureApiError: vi.fn(async () => undefined),
}))

import { handleRefresh, triggerDigestRebuild, EnricherNotConfiguredError } from '../enricher.js'

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null
    },
  }
}

// A distinct caller per test, so the shared in-memory rate-limit buckets from
// one test cannot spill into the next.
let caller = 0
function email() {
  caller += 1
  return `owner${caller}@example.com`
}

beforeEach(() => {
  process.env.ENRICHER_RUN_URL = 'https://data-enricher.example.workers.dev/run'
  process.env.ENRICHER_TRIGGER_TOKEN = 'trigger-secret'
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ENRICHER_RUN_URL
  delete process.env.ENRICHER_TRIGGER_TOKEN
})

describe('triggerDigestRebuild', () => {
  it('asks the Worker for the digest phase only, with the bearer secret', async () => {
    await triggerDigestRebuild()

    const [url, init] = fetch.mock.calls[0]
    expect(url.toString()).toBe('https://data-enricher.example.workers.dev/run?phase=digest')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer trigger-secret')
  })

  it('throws a typed error when the trigger is not configured', async () => {
    delete process.env.ENRICHER_TRIGGER_TOKEN
    await expect(triggerDigestRebuild()).rejects.toBeInstanceOf(EnricherNotConfiguredError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws when the Worker rejects the trigger', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 })
    await expect(triggerDigestRebuild()).rejects.toThrow('Enricher responded 401')
  })
})

describe('handleRefresh', () => {
  it('returns 200 once the digest has been rebuilt', async () => {
    const res = makeRes()
    await handleRefresh({ method: 'POST' }, res, email())

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('rejects a non-POST', async () => {
    const res = makeRes()
    await handleRefresh({ method: 'GET' }, res, email())

    expect(res.statusCode).toBe(405)
    expect(fetch).not.toHaveBeenCalled()
  })

  // An unconfigured deployment is a permanent condition, not a blip: the app
  // falls back to a plain re-read rather than telling the user to retry.
  it('returns 501 when no enricher is wired up', async () => {
    delete process.env.ENRICHER_RUN_URL
    const res = makeRes()
    await handleRefresh({ method: 'POST' }, res, email())

    expect(res.statusCode).toBe(501)
    expect(res.body.error).toMatch(/not configured/)
  })

  it('returns 502 when the Worker fails', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 })
    const res = makeRes()
    await handleRefresh({ method: 'POST' }, res, email())

    expect(res.statusCode).toBe(502)
    // The upstream status must not leak to the browser.
    expect(JSON.stringify(res.body)).not.toContain('500')
  })

  it('rate-limits a caller hammering the button', async () => {
    const who = email()
    const statuses = []
    for (let i = 0; i < 6; i += 1) {
      const res = makeRes()
      await handleRefresh({ method: 'POST' }, res, who)
      statuses.push(res.statusCode)
    }

    expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200])
    expect(statuses.slice(4)).toEqual([429, 429])
  })

  it('rate-limits per caller, not globally', async () => {
    const first = email()
    for (let i = 0; i < 5; i += 1) await handleRefresh({ method: 'POST' }, makeRes(), first)

    const res = makeRes()
    await handleRefresh({ method: 'POST' }, res, email())
    expect(res.statusCode).toBe(200)
  })
})
