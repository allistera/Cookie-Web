import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../send.js'
import { responseRecorder } from '../_fixtures/sendTestResponse.js'

describe('send adapter failures', () => {
  it.each([401, 403, 409, 429, 503])(
    'preserves Worker status %s and error body',
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'Rejected' }, { status }))
      const res = responseRecorder()
      await createHandler({ fetch })({ method: 'POST', body: {}, headers: {} }, res)
      expect(res.statusCode).toBe(status)
      expect(JSON.parse(res.body)).toEqual({ error: 'Rejected' })
    },
  )
  it('reports a provider connection failure without exposing its details', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('private backend detail'))
    const res = responseRecorder()
    await createHandler({ fetch })({ method: 'POST', body: {}, headers: {} }, res)
    expect(res.statusCode).toBe(502)
    expect(res.body).not.toContain('private')
  })
  it('rejects malformed JSON before forwarding', async () => {
    const fetch = vi.fn()
    const res = responseRecorder()
    await createHandler({ fetch })({ method: 'POST', body: '{', headers: {} }, res)
    expect(res.statusCode).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
})
