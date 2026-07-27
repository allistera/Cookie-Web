import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../_lib/auth.js', () => ({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
}))
vi.mock('../_lib/sentry.js', () => ({
  captureApiError: vi.fn(async () => undefined),
}))

// Each tagged-template query resolves to the next queued result, so a test can
// script the ownership check, the write, and the labels read-back in order.
let sqlQueue = []
vi.mock('../_lib/db.js', () => ({
  getSql: () => () => Promise.resolve(sqlQueue.shift() ?? []),
}))

import handler from '../messages.js'

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null
    },
  }
}

const MESSAGE_ID = '11111111-1111-1111-1111-111111111111'
const LABEL_ID = '22222222-2222-2222-2222-222222222222'

function post(body) {
  return { method: 'POST', url: '/api/messages', headers: {}, body }
}

function get(id) {
  return { method: 'GET', url: `/api/messages?id=${id}`, headers: {} }
}

describe('POST /api/messages label actions', () => {
  beforeEach(() => {
    sqlQueue = []
  })

  it('applies a label and returns the message label set', async () => {
    sqlQueue = [
      [{ message: true, label: true }], // ownership check
      [], // INSERT ... ON CONFLICT DO NOTHING
      [{ name: 'Work', color: '#3b82f6', kind: 'user' }], // labels read-back
    ]
    const res = makeRes()
    await handler(post({ id: MESSAGE_ID, action: 'add_label', label_id: LABEL_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ labels: [{ name: 'Work', color: '#3b82f6', kind: 'user' }] })
  })

  it('removes a label and returns the remaining set', async () => {
    sqlQueue = [
      [{ message: true, label: true }],
      [], // DELETE
      [], // no labels left
    ]
    const res = makeRes()
    await handler(post({ id: MESSAGE_ID, action: 'remove_label', label_id: LABEL_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ labels: [] })
  })

  it('rejects a malformed label_id with 400', async () => {
    const res = makeRes()
    await handler(post({ id: MESSAGE_ID, action: 'add_label', label_id: 'not-a-uuid' }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/label_id/)
  })

  it('404s when the message is not the caller’s', async () => {
    sqlQueue = [[{ message: false, label: true }]]
    const res = makeRes()
    await handler(post({ id: MESSAGE_ID, action: 'add_label', label_id: LABEL_ID }), res)

    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('Message not found')
  })

  it('404s when the label is not the caller’s', async () => {
    sqlQueue = [[{ message: true, label: false }]]
    const res = makeRes()
    await handler(post({ id: MESSAGE_ID, action: 'add_label', label_id: LABEL_ID }), res)

    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('Label not found')
  })

  it('rejects an unknown action with 400', async () => {
    const res = makeRes()
    await handler(post({ id: MESSAGE_ID, action: 'frobnicate' }), res)

    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/messages', () => {
  beforeEach(() => {
    sqlQueue = []
  })

  it('returns the message body plus its thread history, oldest first', async () => {
    sqlQueue = [
      [{ id: MESSAGE_ID, thread_id: 'thread-1', body_html: '<p>Hi</p>', body_text: 'Hi', headers: {} }],
      [
        { id: 'earlier-id', from_name: 'Alice', snippet: 'Earlier message', sent_at: '2026-01-01T00:00:00Z' },
        { id: MESSAGE_ID, from_name: 'Bob', snippet: 'Hi', sent_at: '2026-01-02T00:00:00Z' },
      ],
    ]
    const res = makeRes()
    await handler(get(MESSAGE_ID), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.body_html).toBe('<p>Hi</p>')
    expect(res.body.thread).toHaveLength(2)
    expect(res.body.thread[0].id).toBe('earlier-id')
    expect(res.body.headers).toBeUndefined()
  })

  it('404s when the message does not exist or is not the caller’s', async () => {
    sqlQueue = [[]]
    const res = makeRes()
    await handler(get(MESSAGE_ID), res)

    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('Message not found')
  })

  it('rejects a malformed id with 400', async () => {
    const res = makeRes()
    await handler(get('not-a-uuid'), res)

    expect(res.statusCode).toBe(400)
  })
})
