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
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222'

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

  it('returns a null digest and news when the enricher has not written them', async () => {
    sqlQueue = [[], [], []]
    const res = makeRes()

    await handler(req('GET'), res)

    expect(res.body.digest).toBeNull()
    expect(res.body.news).toBeNull()
    // Tasks, digest, news — no cited ids, so no read-state round trip.
    expect(statements).toHaveLength(3)
  })

  it('returns the digest with live read-state alongside the tasks', async () => {
    sqlQueue = [
      [], // fetchTasks
      [
        {
          summary: 'Mostly kitchen news.',
          created_at: '2026-08-03T05:00:00.000Z',
          raw: {
            topics: [
              {
                emoji: '🍳',
                title: 'Kitchen',
                items: [
                  { message_id: MESSAGE_ID, headline: 'Floor plan', note: 'Revised design.' },
                ],
              },
            ],
          },
        },
      ],
      [], // fetchLatestSummary('daily_news')
      [{ id: MESSAGE_ID, is_unread: true }], // fetchMessageStates
    ]
    const res = makeRes()

    await handler(req('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(statements[1]).toContain('FROM summaries s')
    expect(statements[3]).toContain('m.is_unread')
    expect(res.body.digest.topics).toHaveLength(1)
    expect(res.body.digest.topics[0].items[0]).toEqual({
      message_id: MESSAGE_ID,
      headline: 'Floor plan',
      note: 'Revised design.',
      unread: true,
    })
  })

  it('returns the news round-up, dropping items without a usable link', async () => {
    sqlQueue = [
      [], // fetchTasks
      [], // fetchLatestSummary('daily_digest')
      [
        {
          summary: '',
          created_at: '2026-08-04T05:00:00.000Z',
          raw: {
            sections: [
              {
                emoji: '💻',
                title: 'GitHub',
                items: [
                  {
                    title: 'acme/rocket',
                    url: 'https://github.com/acme/rocket',
                    description: 'Fast',
                    note: 'Rust, like you asked for',
                    meta: '★ 10',
                  },
                  // Model output reaches the browser as an href, so anything
                  // that is not a real web link is dropped here.
                  { title: 'Bad', url: 'javascript:alert(1)', description: '', note: '', meta: '' },
                ],
              },
              { emoji: '🚀', title: 'Empty', items: [] },
            ],
          },
        },
      ],
    ]
    const res = makeRes()

    await handler(req('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.news.created_at).toBe('2026-08-04T05:00:00.000Z')
    expect(res.body.news.sections).toHaveLength(1)
    expect(res.body.news.sections[0].items).toEqual([
      {
        title: 'acme/rocket',
        url: 'https://github.com/acme/rocket',
        description: 'Fast',
        note: 'Rust, like you asked for',
        meta: '★ 10',
      },
    ])
  })
})

describe('POST /api/tasks?resource=refresh', () => {
  it('dispatches to the enricher trigger instead of task completion', async () => {
    process.env.ENRICHER_RUN_URL = 'https://data-enricher.example.workers.dev/run'
    process.env.ENRICHER_TRIGGER_TOKEN = 'trigger-secret'
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 })
    const res = makeRes()

    await handler(
      { method: 'POST', url: '/api/tasks?resource=refresh', headers: {} },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    // The refresh path touches the Worker, never the database.
    expect(statements).toHaveLength(0)
    expect(fetch.mock.calls[0][0].toString()).toContain('phase=today')

    delete process.env.ENRICHER_RUN_URL
    delete process.env.ENRICHER_TRIGGER_TOKEN
  })

  it('requires authentication like every other route', async () => {
    const auth = await import('../_lib/auth.js')
    auth.verifyAccessToken.mockRejectedValueOnce(new Error('no token'))
    const res = makeRes()

    await handler({ method: 'POST', url: '/api/tasks?resource=refresh', headers: {} }, res)

    expect(res.statusCode).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
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
