import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../send.js'

import { responseRecorder } from '../_fixtures/sendTestResponse.js'

describe('send compatibility adapter', () => {
  it('preserves request identity and body while forwarding only the bearer credential', async () => {
    const body = {
      to: 'a@example.com',
      subject: 'Hello',
      text: 'Hello',
      requestId: 'retry-1',
      followUpAt: '2026-09-20T10:00:00Z',
    }
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: 'provider', messageId: 'message', followUpScheduled: true }),
      )
    const response = responseRecorder()
    await createHandler({ fetch })(
      {
        method: 'POST',
        url: '/api/send',
        headers: { authorization: 'Bearer fixture', cookie: 'private', host: 'attacker.example' },
        body,
      },
      response,
    )
    expect(fetch).toHaveBeenCalledWith(
      'https://send-api.infinitywave.online/send',
      expect.objectContaining({
        headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
      }),
    )
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      id: 'provider',
      messageId: 'message',
      followUpScheduled: true,
    })
  })
})
