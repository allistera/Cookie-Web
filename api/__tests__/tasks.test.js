import { describe, expect, it } from 'vitest'

import { fetchTasks } from '../tasks.js'

describe('fetchTasks', () => {
  it('reads the tasks table scoped to the user, most-pressing first', () => {
    let query = ''
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchTasks(sql, 'owner@example.com')

    expect(query).toContain('FROM tasks t')
    expect(query).toContain('JOIN users u ON u.id = t.user_id')
    expect(query).toContain('WHERE lower(u.email) =')
    expect(query).toContain('t.content')
    expect(query).toContain('ORDER BY t.due_date ASC NULLS LAST, t.priority DESC NULLS LAST')
  })
})
