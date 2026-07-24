import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchTasks, fetchOwnedTask, deleteOwnedTask, closeTodoistTask } from '../tasks.js'

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
    expect(query).toContain('LEFT JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id')
    expect(query).toContain('WHERE lower(u.email) =')
    expect(query).toContain('t.content')
    expect(query).toContain('m.from_address AS reply_to')
    expect(query).toContain('m.subject AS message_subject')
    expect(query).toContain('ORDER BY t.due_date ASC NULLS LAST, t.priority DESC NULLS LAST')
  })
})

describe('fetchOwnedTask', () => {
  it('selects the completion fields for a task scoped to the owner', () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    fetchOwnedTask(sql, 'task-uuid', 'owner@example.com')

    expect(query).toContain('FROM tasks t')
    expect(query).toContain('t.external_id')
    expect(query).toContain('WHERE t.id =')
    expect(query).toContain('lower(u.email) =')
    expect(values).toEqual(['task-uuid', 'owner@example.com'])
  })
})

describe('deleteOwnedTask', () => {
  it('deletes only the owner\'s task row', () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    deleteOwnedTask(sql, 'task-uuid', 'owner@example.com')

    expect(query).toContain('DELETE FROM tasks t')
    expect(query).toContain('USING users u')
    expect(query).toContain('t.user_id = u.id')
    expect(query).toContain('lower(u.email) =')
    expect(values).toEqual(['task-uuid', 'owner@example.com'])
  })
})

describe('closeTodoistTask', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the unified API close endpoint with a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await closeTodoistTask('9876543210', 'tok_abc')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.todoist.com/api/v1/tasks/9876543210/close')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer tok_abc')
  })

  it('throws when Todoist responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))

    await expect(closeTodoistTask('1', 'tok')).rejects.toThrow('403')
  })
})
