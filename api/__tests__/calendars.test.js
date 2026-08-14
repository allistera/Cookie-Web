import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler, fetchCalendars } from '../_lib/calendars.js'

// Each tagged-template query resolves to the next queued result, so a test
// can script the sequence of reads/writes the handler issues in order.
// sql.begin(fn) runs fn against the same queue-consuming function, since
// none of these tests need real transactional isolation.
let sqlQueue = []
const queriesRun = []
function makeSql() {
  const run = (strings, ...values) => {
    queriesRun.push({ text: strings.join('?'), values })
    return Promise.resolve(sqlQueue.shift() ?? [])
  }
  run.begin = async (fn) => fn(run)
  return run
}

const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
  getSql: () => makeSql(),
})

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

const CALENDAR_ID = '11111111-1111-1111-1111-111111111111'

function get() {
  return { method: 'GET', url: '/api/calendar-events?resource=calendars', headers: {} }
}
function post(body) {
  return { method: 'POST', url: '/api/calendar-events?resource=calendars', headers: {}, body }
}
function patch(body) {
  return { method: 'PATCH', url: '/api/calendar-events?resource=calendars', headers: {}, body }
}
function del(body) {
  return { method: 'DELETE', url: '/api/calendar-events?resource=calendars', headers: {}, body }
}

describe('fetchCalendars', () => {
  it('reads the calendars table scoped to the user, oldest first', () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    fetchCalendars(sql, 'owner@example.com')

    expect(query).toContain('FROM calendars c')
    expect(query).toContain('JOIN users u ON u.id = c.user_id')
    expect(query).toContain('WHERE lower(u.email) =')
    expect(query).toContain('ORDER BY c.created_at, c.id')
    expect(values).toEqual(['owner@example.com'])
  })
})

describe('GET calendar management', () => {
  beforeEach(() => {
    sqlQueue = []
    queriesRun.length = 0
  })

  it('returns existing calendars without seeding', async () => {
    sqlQueue = [[{ id: CALENDAR_ID, name: 'Work', color: '#4f7c6b' }]]
    const res = makeRes()
    await handler(get(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ calendars: [{ id: CALENDAR_ID, name: 'Work', color: '#4f7c6b' }] })
  })

  it('seeds five default calendars for a user with none yet', async () => {
    const defaults = [
      { id: 'id-1', name: 'Work', color: '#4f7c6b' },
      { id: 'id-2', name: 'Personal', color: '#2db985' },
      { id: 'id-3', name: 'Focus time', color: '#795da8' },
      { id: 'id-4', name: 'Birthdays', color: '#d8953b' },
      { id: 'id-5', name: 'Holidays', color: '#d15c4e' },
    ]
    sqlQueue = [
      [], // fetchCalendars: empty
      [], // one atomic INSERT
      defaults, // canonical refetch
    ]
    const res = makeRes()
    await handler(get(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.calendars).toHaveLength(5)
    expect(res.body.calendars.map((c) => c.name)).toEqual([
      'Work',
      'Personal',
      'Focus time',
      'Birthdays',
      'Holidays',
    ])
  })

  it('returns legacy defaults while the expand migration is still pending', async () => {
    sqlQueue = [Promise.reject(Object.assign(new Error('missing table'), { code: '42P01' }))]
    const res = makeRes()
    await handler(get(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.calendars.map((calendar) => calendar.id)).toEqual([
      'work',
      'personal',
      'focus',
      'birthdays',
      'holidays',
    ])
  })
})

describe('POST calendar management', () => {
  beforeEach(() => {
    sqlQueue = []
    queriesRun.length = 0
  })

  it('creates a calendar', async () => {
    sqlQueue = [[{ id: CALENDAR_ID, name: 'Trips', color: '#3b82f6' }]]
    const res = makeRes()
    await handler(post({ name: 'Trips', color: '#3b82f6' }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ calendar: { id: CALENDAR_ID, name: 'Trips', color: '#3b82f6' } })
  })

  it('409s when the insert is skipped by the unique constraint', async () => {
    sqlQueue = [[]]
    const res = makeRes()
    await handler(post({ name: 'Work', color: '#3b82f6' }), res)

    expect(res.statusCode).toBe(409)
  })

  it('rejects a missing name or invalid color with 400', async () => {
    const res = makeRes()
    await handler(post({ name: '', color: '#3b82f6' }), res)
    expect(res.statusCode).toBe(400)

    const res2 = makeRes()
    await handler(post({ name: 'Trips', color: 'not-a-color' }), res2)
    expect(res2.statusCode).toBe(400)
  })
})

describe('PATCH calendar management', () => {
  beforeEach(() => {
    sqlQueue = []
    queriesRun.length = 0
  })

  it('renames a calendar', async () => {
    sqlQueue = [[{ id: CALENDAR_ID, name: 'Travel', color: '#3b82f6' }]]
    const res = makeRes()
    await handler(patch({ id: CALENDAR_ID, name: 'Travel' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.calendar.name).toBe('Travel')
  })

  it('404s when the calendar is not the caller’s', async () => {
    sqlQueue = [[]]
    const res = makeRes()
    await handler(patch({ id: CALENDAR_ID, name: 'Travel' }), res)

    expect(res.statusCode).toBe(404)
  })

  it('409s on a duplicate-name unique violation', async () => {
    sqlQueue = [Promise.reject(Object.assign(new Error('duplicate'), { code: '23505' }))]
    const res = makeRes()
    await handler(patch({ id: CALENDAR_ID, name: 'Work' }), res)

    expect(res.statusCode).toBe(409)
  })

  it('rejects a malformed id or empty name with 400', async () => {
    const res = makeRes()
    await handler(patch({ id: 'not-a-uuid', name: 'Travel' }), res)
    expect(res.statusCode).toBe(400)

    const res2 = makeRes()
    await handler(patch({ id: CALENDAR_ID, name: '' }), res2)
    expect(res2.statusCode).toBe(400)
  })
})

describe('DELETE calendar management', () => {
  beforeEach(() => {
    sqlQueue = []
    queriesRun.length = 0
  })

  it('deletes a calendar with no events', async () => {
    sqlQueue = [
      [{ isSubscribed: false }], // ownership + subscription check
      [{ count: 0 }], // event count
      [], // DELETE
    ]
    const res = makeRes()
    await handler(del({ id: CALENDAR_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('409s if the database FK catches a concurrent event create', async () => {
    sqlQueue = [
      [{ isSubscribed: false }],
      [{ count: 0 }],
      Promise.reject(Object.assign(new Error('still referenced'), { code: '23503' })),
    ]
    const res = makeRes()
    await handler(del({ id: CALENDAR_ID }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toContain('events')
  })

  it('409s with the event count when the calendar still has events', async () => {
    sqlQueue = [[{ isSubscribed: false }], [{ count: 3 }]]
    const res = makeRes()
    await handler(del({ id: CALENDAR_ID }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toContain('3 events')
  })

  it('404s when the calendar is not the caller’s', async () => {
    sqlQueue = [[]]
    const res = makeRes()
    await handler(del({ id: CALENDAR_ID }), res)

    expect(res.statusCode).toBe(404)
  })

  it('cascade-deletes a subscribed calendar even though it has events, skipping the event-count check', async () => {
    sqlQueue = [[{ isSubscribed: true }]]
    const res = makeRes()
    await handler(del({ id: CALENDAR_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(queriesRun.some((q) => q.text.includes('DELETE FROM calendar_events'))).toBe(true)
    expect(queriesRun.some((q) => q.text.includes('DELETE FROM calendars'))).toBe(true)
    expect(queriesRun.some((q) => q.text.includes('count(*)'))).toBe(false)
  })

  it('rejects a malformed id with 400', async () => {
    const res = makeRes()
    await handler(del({ id: 'not-a-uuid' }), res)

    expect(res.statusCode).toBe(400)
  })
})
