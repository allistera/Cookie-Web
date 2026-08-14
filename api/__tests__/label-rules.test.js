import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../_lib/label-rules.js'

// Each tagged-template query resolves to the next queued result, in call
// order, so a test can script the exact sequence of round trips a handler
// branch makes (including the inserts inside sql.begin()).
let sqlQueue = []
const verifyAccessToken = vi.fn(async () => ({ email: 'owner@example.com' }))

const handler = createHandler({
  verifyAccessToken,
  getSql: () => {
    const fn = () => Promise.resolve(sqlQueue.shift() ?? [])
    fn.begin = async (callback) => callback(fn)
    return fn
  },
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

const RULE_ID = '11111111-1111-1111-1111-111111111111'
const LABEL_ID = '22222222-2222-2222-2222-222222222222'

function req(method, body) {
  return { method, url: '/api/label-rules', headers: {}, body }
}

beforeEach(() => {
  sqlQueue = []
})

describe('GET /api/label-rules', () => {
  it('groups condition rows under their rule', async () => {
    sqlQueue = [[
      {
        id: RULE_ID, name: 'Bills', label_id: LABEL_ID, action: 'apply_label', match_type: 'all', enabled: true,
        created_at: '2026-01-01', condition_id: 'c1', field: 'subject', operator: 'contains', value: 'invoice', position: 0,
      },
      {
        id: RULE_ID, name: 'Bills', label_id: LABEL_ID, action: 'apply_label', match_type: 'all', enabled: true,
        created_at: '2026-01-01', condition_id: 'c2', field: 'from', operator: 'contains', value: 'billing@', position: 1,
      },
    ]]

    const res = makeRes()
    await handler(req('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.rules).toHaveLength(1)
    expect(res.body.rules[0].conditions).toEqual([
      { id: 'c1', field: 'subject', operator: 'contains', value: 'invoice' },
      { id: 'c2', field: 'from', operator: 'contains', value: 'billing@' },
    ])
  })

  it('returns an empty list with no rules', async () => {
    sqlQueue = [[]]
    const res = makeRes()
    await handler(req('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ rules: [] })
  })
})

describe('POST /api/label-rules', () => {
  it('creates a rule with its conditions', async () => {
    sqlQueue = [
      [{ id: RULE_ID, name: 'Bills', label_id: LABEL_ID, match_type: 'all', enabled: true }], // INSERT rule
      [], // INSERT condition
    ]
    const res = makeRes()
    await handler(req('POST', {
      name: 'Bills',
      label_id: LABEL_ID,
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
    }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.rule).toEqual({
      id: RULE_ID, name: 'Bills', label_id: LABEL_ID, match_type: 'all', enabled: true,
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice', position: 0 }],
    })
  })

  it('rejects a request with no conditions', async () => {
    const res = makeRes()
    await handler(req('POST', { label_id: LABEL_ID, conditions: [] }), res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid field or operator', async () => {
    const res = makeRes()
    await handler(req('POST', {
      label_id: LABEL_ID,
      conditions: [{ field: 'cc', operator: 'contains', value: 'x' }],
    }), res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects a missing label_id', async () => {
    const res = makeRes()
    await handler(req('POST', {
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
    }), res)

    expect(res.statusCode).toBe(400)
  })

  it('404s when the label is not the caller\'s', async () => {
    sqlQueue = [[]] // INSERT ... SELECT joins to nothing, RETURNING empty
    const res = makeRes()
    await handler(req('POST', {
      label_id: LABEL_ID,
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
    }), res)

    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('Label not found')
  })

  it('creates a mark_done rule with no label_id', async () => {
    sqlQueue = [
      [{ id: RULE_ID, name: 'Spam', label_id: null, action: 'mark_done', match_type: 'all', enabled: true }], // INSERT rule
      [], // INSERT condition
    ]
    const res = makeRes()
    await handler(req('POST', {
      name: 'Spam',
      action: 'mark_done',
      conditions: [{ field: 'from', operator: 'contains', value: 'noreply@' }],
    }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.rule).toEqual({
      id: RULE_ID, name: 'Spam', label_id: null, action: 'mark_done', match_type: 'all', enabled: true,
      conditions: [{ field: 'from', operator: 'contains', value: 'noreply@', position: 0 }],
    })
  })

  it('rejects a mark_done rule with a label_id', async () => {
    const res = makeRes()
    await handler(req('POST', {
      action: 'mark_done',
      label_id: LABEL_ID,
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
    }), res)

    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/label-rules', () => {
  it('toggles enabled without touching other fields', async () => {
    sqlQueue = [
      [{ name: 'Bills', label_id: LABEL_ID, match_type: 'all', enabled: true }], // existing
      [{ id: RULE_ID, name: 'Bills', label_id: LABEL_ID, match_type: 'all', enabled: false }], // UPDATE
      [{ field: 'subject', operator: 'contains', value: 'invoice', position: 0 }], // conditions read-back
    ]
    const res = makeRes()
    await handler(req('PATCH', { id: RULE_ID, enabled: false }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.rule.enabled).toBe(false)
  })

  it('replaces conditions when provided', async () => {
    sqlQueue = [
      [{ name: 'Bills', label_id: LABEL_ID, match_type: 'all', enabled: true }], // existing
      [{ id: RULE_ID, name: 'Bills', label_id: LABEL_ID, match_type: 'any', enabled: true }], // UPDATE
      [], // DELETE conditions
      [], // INSERT condition
    ]
    const res = makeRes()
    await handler(req('PATCH', {
      id: RULE_ID,
      match_type: 'any',
      conditions: [{ field: 'to', operator: 'equals', value: 'me@example.com' }],
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.rule.conditions).toEqual([
      { field: 'to', operator: 'equals', value: 'me@example.com', position: 0 },
    ])
  })

  it('404s when the rule is not the caller\'s', async () => {
    sqlQueue = [[]] // no existing row
    const res = makeRes()
    await handler(req('PATCH', { id: RULE_ID, enabled: false }), res)

    expect(res.statusCode).toBe(404)
  })

  it('switches a rule to mark_done and clears its label_id', async () => {
    sqlQueue = [
      [{ name: 'Bills', label_id: LABEL_ID, action: 'apply_label', match_type: 'all', enabled: true }], // existing
      [{ id: RULE_ID, name: 'Bills', label_id: null, action: 'mark_done', match_type: 'all', enabled: true }], // UPDATE
      [{ field: 'subject', operator: 'contains', value: 'invoice', position: 0 }], // conditions read-back
    ]
    const res = makeRes()
    await handler(req('PATCH', { id: RULE_ID, action: 'mark_done' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.rule.action).toBe('mark_done')
    expect(res.body.rule.label_id).toBeNull()
  })

  it('rejects setting label_id alongside a mark_done action', async () => {
    sqlQueue = [
      [{ name: 'Bills', label_id: LABEL_ID, action: 'apply_label', match_type: 'all', enabled: true }], // existing
    ]
    const res = makeRes()
    await handler(req('PATCH', { id: RULE_ID, action: 'mark_done', label_id: LABEL_ID }), res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid action', async () => {
    const res = makeRes()
    await handler(req('PATCH', { id: RULE_ID, action: 'delete_forever' }), res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects a body with no recognized fields', async () => {
    const res = makeRes()
    await handler(req('PATCH', { id: RULE_ID }), res)

    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/label-rules', () => {
  it('deletes an owned rule', async () => {
    sqlQueue = [[{ id: RULE_ID }]]
    const res = makeRes()
    await handler(req('DELETE', { id: RULE_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('404s when nothing is deleted', async () => {
    sqlQueue = [[]]
    const res = makeRes()
    await handler(req('DELETE', { id: RULE_ID }), res)

    expect(res.statusCode).toBe(404)
  })

  it('rejects a malformed id', async () => {
    const res = makeRes()
    await handler(req('DELETE', { id: 'not-a-uuid' }), res)

    expect(res.statusCode).toBe(400)
  })
})

describe('unauthenticated and unsupported methods', () => {
  it('401s without a valid token', async () => {
    verifyAccessToken.mockRejectedValueOnce(new Error('no token'))

    const res = makeRes()
    await handler(req('GET'), res)

    expect(res.statusCode).toBe(401)
  })

  it('405s on unsupported methods', async () => {
    const res = makeRes()
    await handler(req('PUT'), res)

    expect(res.statusCode).toBe(405)
  })
})
