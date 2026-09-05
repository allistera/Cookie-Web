import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../send.js'
import { responseRecorder } from '../_fixtures/sendTestResponse.js'

describe('legacy resource routing', () => {
  it.each([
    ['scheduled', 'GET'],
    ['scheduled', 'DELETE'],
    ['follow-up', 'PATCH'],
    ['flush', 'POST'],
  ])('maps %s %s to the Worker clean path', async (resource, method) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const res = responseRecorder()
    await createHandler({ fetch })(
      { method, url: `/api/send?resource=${resource}`, headers: {}, body: { id: 'fixture' } },
      res,
    )
    expect(fetch).toHaveBeenCalledWith(
      `https://send-api.infinitywave.online/send/${resource}`,
      expect.objectContaining({ method }),
    )
    expect(res.statusCode).toBe(200)
  })
  it.each([
    ['unknown', 'POST', 404],
    ['scheduled', 'POST', 405],
    ['flush', 'GET', 405],
  ])('rejects %s %s', async (resource, method, status) => {
    const fetch = vi.fn()
    const res = responseRecorder()
    await createHandler({ fetch })(
      { method, url: `/api/send?resource=${resource}`, headers: {} },
      res,
    )
    expect(res.statusCode).toBe(status)
    expect(fetch).not.toHaveBeenCalled()
  })
})
