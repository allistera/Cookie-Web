import { describe, expect, it } from 'vitest'

import { fetchContacts } from '../_lib/contacts.js'

describe('fetchContacts', () => {
  it('reads the contacts view scoped to the authenticated user', () => {
    let query = ''
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchContacts(sql, 'owner@example.com')

    expect(query).toContain('FROM contacts c')
    expect(query).toContain('JOIN users u ON u.id = c.user_id')
    expect(query).toContain('WHERE lower(u.email) =')
    expect(query).toContain('c.address')
    expect(query).toContain('c.name')
    expect(query).toContain('ORDER BY')
  })
})
