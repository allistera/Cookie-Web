import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchTasks,
  fetchOwnedTask,
  deleteOwnedTask,
  closeTodoistTask,
  fetchLatestSummary,
  fetchMessageStates,
  digestMessageIds,
  buildDigest,
} from '../tasks.js'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_C = '33333333-3333-4333-8333-333333333333'
const USER_ID = '99999999-9999-9999-9999-999999999999'

function digestRow(topics, summary = 'Mostly kitchen news.') {
  return { summary, raw: { topics }, created_at: '2026-08-03T05:00:00.000Z' }
}

describe('fetchTasks', () => {
  it('reads the tasks table scoped to the user, most-pressing first', () => {
    let query = ''
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchTasks(sql, USER_ID)

    expect(query).toContain('FROM tasks t')
    expect(query).toContain('LEFT JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id')
    expect(query).toContain('WHERE t.user_id =')
    expect(query).toContain('t.content')
    expect(query).toContain('m.from_address AS reply_to')
    expect(query).toContain('m.subject AS message_subject')
    expect(query).toContain('ORDER BY t.due_date ASC NULLS LAST, t.priority DESC NULLS LAST')
    expect(query).toContain('t.gathered_at')
  })

  it('scopes Todoist tasks to due today or overdue, leaving email tasks unfiltered', () => {
    let query = ''
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchTasks(sql, USER_ID)

    expect(query).toContain("t.source <> 'todoist' OR t.due_date <= CURRENT_DATE")
  })
})

describe('fetchLatestSummary', () => {
  it('reads the newest whole-mailbox row of the given kind', () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    fetchLatestSummary(sql, USER_ID, 'daily_digest')

    expect(query).toContain('FROM summaries s')
    expect(query).toContain('WHERE s.user_id =')
    // These are the rows with no message; per-message summaries are not.
    expect(query).toContain('s.message_id IS NULL')
    expect(query).toContain('ORDER BY s.created_at DESC')
    expect(query).toContain('LIMIT 1')
    expect(values).toEqual([USER_ID, 'daily_digest'])
  })
})

describe('fetchMessageStates', () => {
  it('reads live read-state, excluding deleted mail but keeping archived mail', () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    fetchMessageStates(sql, USER_ID, [ID_A])

    expect(query).toContain('m.is_unread')
    expect(query).toContain('WHERE m.user_id =')
    expect(query).toContain('::uuid[]')
    expect(query).toContain('NOT m.is_deleted')
    expect(query).not.toContain('is_archived')
    expect(values).toEqual([USER_ID, [ID_A]])
  })
})

describe('digestMessageIds', () => {
  it('collects the cited ids without duplicates', () => {
    const row = digestRow([
      { items: [{ message_id: ID_A }, { message_id: ID_B }] },
      { items: [{ message_id: ID_A }, { message_id: ID_C }] },
    ])
    expect(digestMessageIds(row)).toEqual([ID_A, ID_B, ID_C])
  })

  // The ids are model output, so they must never reach a ::uuid[] cast unchecked.
  it('discards anything that is not a uuid', () => {
    const row = digestRow([
      { items: [{ message_id: ID_A }, { message_id: "'); DROP TABLE messages;--" }] },
      { items: [{ message_id: null }, { message_id: 42 }, {}] },
    ])
    expect(digestMessageIds(row)).toEqual([ID_A])
  })

  it('returns nothing for a missing or malformed row', () => {
    expect(digestMessageIds(undefined)).toEqual([])
    expect(digestMessageIds({ raw: null })).toEqual([])
    expect(digestMessageIds({ raw: { topics: 'nope' } })).toEqual([])
  })
})

describe('buildDigest', () => {
  it('folds live read-state into the stored digest', () => {
    const row = digestRow([
      {
        emoji: '🍳',
        title: 'Kitchen',
        items: [
          { message_id: ID_A, headline: 'Floor plan', note: 'Revised design.' },
          { message_id: ID_B, headline: 'Claim', note: 'Processed.' },
        ],
      },
    ])
    const digest = buildDigest(row, [
      { id: ID_A, is_unread: true },
      { id: ID_B, is_unread: false },
    ])

    expect(digest.overview).toBe('Mostly kitchen news.')
    expect(digest.created_at).toBe('2026-08-03T05:00:00.000Z')
    expect(digest.topics[0].items).toEqual([
      { message_id: ID_A, headline: 'Floor plan', note: 'Revised design.', unread: true },
      { message_id: ID_B, headline: 'Claim', note: 'Processed.', unread: false },
    ])
  })

  // The digest is an overnight snapshot; mail can be deleted since (archiving
  // no longer drops it - fetchMessageStates keeps archived mail in states).
  it('drops items whose message left the mailbox, and topics that empties', () => {
    const row = digestRow([
      { emoji: '🍳', title: 'Kitchen', items: [{ message_id: ID_A }, { message_id: ID_B }] },
      { emoji: '📣', title: 'Gone', items: [{ message_id: ID_C }] },
    ])
    const digest = buildDigest(row, [{ id: ID_A, is_unread: true }])

    expect(digest.topics).toHaveLength(1)
    expect(digest.topics[0].title).toBe('Kitchen')
    expect(digest.topics[0].items.map((i) => i.message_id)).toEqual([ID_A])
  })

  it('is null when no digest has been written yet', () => {
    expect(buildDigest(undefined, [])).toBeNull()
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

    fetchOwnedTask(sql, 'task-uuid', USER_ID)

    expect(query).toContain('FROM tasks t')
    expect(query).toContain('t.external_id')
    expect(query).toContain('WHERE t.id =')
    expect(query).toContain('t.user_id =')
    expect(values).toEqual(['task-uuid', USER_ID])
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

    deleteOwnedTask(sql, 'task-uuid', USER_ID)

    expect(query).toContain('DELETE FROM tasks t')
    expect(query).toContain('t.user_id =')
    expect(values).toEqual(['task-uuid', USER_ID])
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
