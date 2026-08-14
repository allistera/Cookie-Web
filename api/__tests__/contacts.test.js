import { describe, expect, it, vi } from 'vitest'

import { createHandler, fetchContacts } from '../_lib/contacts.js'

const contactsHandler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
  getSql: () => () => Promise.resolve([{ address: 'a@example.com', name: 'A' }]),
})

describe('fetchContacts', () => {
  it('reads the contacts view scoped to the authenticated user, bounded', () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    fetchContacts(sql, 'owner@example.com')

    expect(query).toContain('FROM contacts c')
    expect(query).toContain('JOIN users u ON u.id = c.user_id')
    expect(query).toContain('WHERE lower(u.email) =')
    expect(query).toContain('c.address')
    expect(query).toContain('c.name')
    expect(query).toContain('ORDER BY')
    expect(query).toContain('LIMIT')
    expect(values).toEqual(['owner@example.com', 2000])
  })
})

describe('GET contacts handler', () => {
  it('marks the response privately cacheable — the view recomputes the whole mailbox per read', async () => {
    const res = {
      statusCode: 0,
      headers: {},
      body: null,
      setHeader(name, value) {
        this.headers[name] = value
      },
      end(payload) {
        this.body = JSON.parse(payload)
      },
    }
    await contactsHandler({ method: 'GET', url: '/api/messages?resource=contacts', headers: {} }, res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('private, max-age=300')
    expect(res.body).toEqual({ contacts: [{ address: 'a@example.com', name: 'A' }] })
  })
})
