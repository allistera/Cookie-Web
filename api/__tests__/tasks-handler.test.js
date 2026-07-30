import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../_lib/auth.js', () => ({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
}))
vi.mock('../_lib/sentry.js', () => ({
  captureApiError: vi.fn(async () => undefined),
}))

// Each tagged-template query resolves to the next queued result, in call
// order, and every statement's SQL text is recorded so a test can assert on
// which round trips the handler actually made.
let sqlQueue = []
let statements = []
vi.mock('../_lib/db.js', () => ({
  getSql: () => {
    const fn = (strings) => {
      statements.push(strings.join('?'))
      return Promise.resolve(sqlQueue.shift() ?? [])
    }
    fn.begin = async (callback) => callback(fn)
    return fn
  },
}))

import handler from '../tasks.js'

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

const TASK_ID = '11111111-1111-1111-1111-111111111111'

function req(method, body) {
  return { method, url: '/api/tasks', headers: {}, body }
}

beforeEach(() => {
  sqlQueue = []
  statements = []
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TODOIST_API_TOKEN
})

describe('GET /api/tasks', () => {
  it('returns the caller’s gathered tasks', async () => {
    sqlQueue = [[{ id: TASK_ID, source: 'email', content: 'Reply to Ana' }]]
    const res = makeRes()

    await handler(req('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.tasks).toHaveLength(1)
    expect(statements[0]).toContain('lower(u.email) = ?')
  })
})

describe('POST /api/tasks', () => {
  it('completes an email-sourced task without calling Todoist', async () => {
    sqlQueue = [
      [{ id: TASK_ID, source: 'email', external_id: null }], // fetchOwnedTask
      [], // deleteOwnedTask
    ]
    const res = makeRes()

    await handler(req('POST', { id: TASK_ID, action: 'complete' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, closedInTodoist: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(statements[1]).toContain('DELETE FROM tasks')
  })

  it('closes a Todoist-sourced task remotely before dropping the local row', async () => {
    process.env.TODOIST_API_TOKEN = 'tok'
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 204 })
    sqlQueue = [
      [{ id: TASK_ID, source: 'todoist', external_id: '9001' }],
      [],
    ]
    const res = makeRes()

    await handler(req('POST', { id: TASK_ID, action: 'complete' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, closedInTodoist: true })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/tasks/9001/close',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(statements[1]).toContain('DELETE FROM tasks')
  })

  // The whole point of closing remotely first: a task that could not be closed
  // in Todoist must stay visible in Cookie rather than silently vanishing.
  it('keeps the local row when the Todoist close fails', async () => {
    process.env.TODOIST_API_TOKEN = 'tok'
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 })
    sqlQueue = [[{ id: TASK_ID, source: 'todoist', external_id: '9001' }]]
    const res = makeRes()

    await handler(req('POST', { id: TASK_ID, action: 'complete' }), res)

    expect(res.statusCode).toBe(502)
    expect(statements.some((text) => text.includes('DELETE FROM tasks'))).toBe(false)
  })

  it('404s when the task is not the caller’s', async () => {
    sqlQueue = [[]]
    const res = makeRes()

    await handler(req('POST', { id: TASK_ID, action: 'complete' }), res)

    expect(res.statusCode).toBe(404)
    expect(statements.some((text) => text.includes('DELETE FROM tasks'))).toBe(false)
  })

  it('rejects a malformed id before touching the database', async () => {
    const res = makeRes()

    await handler(req('POST', { id: 'not-a-uuid', action: 'complete' }), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })

  it('rejects an unsupported action', async () => {
    const res = makeRes()

    await handler(req('POST', { id: TASK_ID, action: 'delete' }), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })
})

describe('unauthenticated and unsupported methods', () => {
  it('401s without a valid token', async () => {
    const auth = await import('../_lib/auth.js')
    auth.verifyAccessToken.mockRejectedValueOnce(new Error('no token'))
    const res = makeRes()

    await handler(req('GET'), res)

    expect(res.statusCode).toBe(401)
  })

  it('405s on unsupported methods', async () => {
    const res = makeRes()

    await handler(req('DELETE'), res)

    expect(res.statusCode).toBe(405)
  })
})
