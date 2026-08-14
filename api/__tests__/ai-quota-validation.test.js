import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAskHandler } from '../ask.js'
import { createSearchHandler } from '../search.js'

const services = {
  allowRequest: vi.fn(),
  getSql: vi.fn(),
  verifyAccessToken: vi.fn(async () => ({ userId: 'user-1' })),
}
const askHandler = createAskHandler(services)
const searchHandler = createSearchHandler(services)

function response() {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null
    },
  }
}

describe('AI quota validation order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key'
    services.getSql.mockReturnValue(() => Promise.resolve([]))
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('does not claim Ask quota for an invalid question', async () => {
    const res = response()

    await askHandler({ method: 'POST', headers: {}, body: { question: '   ' } }, res)

    expect(res.statusCode).toBe(400)
    expect(services.getSql).not.toHaveBeenCalled()
    expect(services.allowRequest).not.toHaveBeenCalled()
  })

  it('does not claim Ask quota for malformed JSON', async () => {
    const res = response()

    await askHandler({ method: 'POST', headers: {}, body: '{' }, res)

    expect(res.statusCode).toBe(400)
    expect(services.getSql).not.toHaveBeenCalled()
    expect(services.allowRequest).not.toHaveBeenCalled()
  })

  it('does not claim Search quota for a parsed query with no work', async () => {
    const res = response()

    await searchHandler({ method: 'GET', headers: {}, url: '/api/search?q=from:%22%22' }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ emails: [] })
    expect(services.getSql).not.toHaveBeenCalled()
    expect(services.allowRequest).not.toHaveBeenCalled()
  })

  it('does not claim Search quota for a filters-only query', async () => {
    const res = response()

    await searchHandler({ method: 'GET', headers: {}, url: '/api/search?q=tag:Personal' }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ emails: [] })
    expect(services.getSql).toHaveBeenCalledTimes(1)
    expect(services.allowRequest).not.toHaveBeenCalled()
  })
})
