import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../tasks.js'
import { cleanText, normalizeBlocks, MAX_BLOCKS_BYTES } from '../_lib/documents.js'

// Each tagged-template query resolves to the next queued result, in call
// order, and every statement's SQL text is recorded so a test can assert on
// which round trips the handler actually made. Calling the fake with a plain
// object (postgres.js's dynamic-set helper, sql(updates)) records the column
// names instead, and sql.json marks its value the way the driver would.
let sqlQueue = []
let statements = []
function getSql() {
  const fn = (strings) => {
    if (Array.isArray(strings)) {
      statements.push(strings.join('?'))
      return Promise.resolve(sqlQueue.shift() ?? [])
    }
    statements.push(`SET(${Object.keys(strings).join(',')})`)
    return { helper: strings }
  }
  fn.json = (value) => ({ json: value })
  fn.array = (value) => ({ array: value })
  fn.begin = async (callback) => callback(fn)
  return fn
}

const USER_ID = '55555555-5555-4555-8555-555555555555'

// Real embedding/rate-limit services are wired into createServices() by
// default (documents.js's save-time embedding needs them). Faked here so
// title/blocks-touching tests never make a real OpenAI call or an
// unaccounted-for rate-limit query — allowRequest denies, so computeSearchFields
// stops right after computing content_text, exactly like a rate-limited save
// in production.
const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
  getSql,
  allowRequest: vi.fn(async () => false),
  embedText: vi.fn(async () => {
    throw new Error('embedText should not be called when allowRequest denies')
  }),
  embedTextCached: vi.fn(async () => {
    throw new Error('embedTextCached should not be called in these tests')
  }),
})

const DOC_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_ID = '44444444-4444-4444-8444-444444444444'
const TEMPLATE_ID = '66666666-6666-4666-8666-666666666666'

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

function req(method, body, params = '') {
  return { method, url: `/api/tasks?resource=documents${params}`, headers: {}, body }
}

beforeEach(() => {
  sqlQueue = []
  statements = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/tasks?resource=documents', () => {
  it('returns the caller’s folders and documents together', async () => {
    sqlQueue = [
      [{ id: FOLDER_ID, parent_id: null, title: 'Projects', emoji: '📁' }],
      [{ id: DOC_ID, folder_id: FOLDER_ID, title: 'Notes', starred: false }],
    ]
    const res = makeRes()

    await handler(req('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.folders).toHaveLength(1)
    expect(res.body.documents).toHaveLength(1)
    expect(statements[0]).toContain('f.user_id = ?')
    expect(statements[1]).toContain('d.user_id = ?')
  })

  it('returns a single document with blocks when an id is given', async () => {
    sqlQueue = [[{ id: DOC_ID, title: 'Notes', blocks: [{ type: 'paragraph' }] }]]
    const res = makeRes()

    await handler(req('GET', undefined, `&id=${DOC_ID}`), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.document.blocks).toEqual([{ type: 'paragraph' }])
    expect(statements[0]).toContain('d.blocks')
  })

  it('rejects a non-uuid id without touching the database', async () => {
    const res = makeRes()

    await handler(req('GET', undefined, '&id=not-a-uuid'), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })

  it('404s a document the caller does not own', async () => {
    sqlQueue = [[]]
    const res = makeRes()

    await handler(req('GET', undefined, `&id=${DOC_ID}`), res)

    expect(res.statusCode).toBe(404)
  })

  it('lists template metadata without loading blocks', async () => {
    sqlQueue = [[{ id: TEMPLATE_ID, title: 'Meeting notes', emoji: '📄' }]]
    const res = makeRes()

    await handler(req('GET', undefined, '&templates'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.templates[0].title).toBe('Meeting notes')
    expect(statements[0]).not.toContain('t.blocks')
  })

  it('returns one owned template with its blocks', async () => {
    sqlQueue = [[{ id: TEMPLATE_ID, title: 'Meeting notes', blocks: [{ type: 'header' }] }]]
    const res = makeRes()

    await handler(req('GET', undefined, `&templateId=${TEMPLATE_ID}`), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.template.blocks).toEqual([{ type: 'header' }])
    expect(statements[0]).toContain('t.blocks')
  })
})

// keywordLeg/recencyLeg/vectorLeg (documentRetrieval.js) compose nested sql
// fragments (textMatch/rankExpr/filterClause), the same pattern api/search.js
// uses via retrieval.js — this file's getSql() fake executes every
// array-tagged call as a real, queue-consuming query and has no concept of a
// fragment nested inside another template, so it can't fake those legs'
// output. Covered instead at the SQL-building level in
// documentRetrieval.test.js (mirroring retrieval-query.test.js), which is
// also why search.js itself has no handler-level test. Only the guard
// clauses that return before any leg runs are covered here.
describe('GET /api/tasks?resource=documents&q=… (search)', () => {
  it('429s when the shared ai quota is exhausted', async () => {
    const searchHandler = createHandler({
      verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
      getSql,
      allowRequest: vi.fn(async () => false),
      embedText: vi.fn(),
      embedTextCached: vi.fn(),
    })
    const res = makeRes()

    await searchHandler(req('GET', undefined, '&q=roadmap'), res)

    expect(res.statusCode).toBe(429)
    expect(statements).toHaveLength(0)
  })

  it('rejects an oversized query', async () => {
    const res = makeRes()

    await handler(req('GET', undefined, `&q=${'x'.repeat(501)}`), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })
})

describe('POST /api/tasks?resource=documents', () => {
  it('creates a document in a folder the caller owns', async () => {
    sqlQueue = [
      [{ id: USER_ID }],
      [{ id: FOLDER_ID }],
      [{ id: DOC_ID, folder_id: FOLDER_ID, title: '', blocks: [] }],
    ]
    const res = makeRes()

    await handler(req('POST', { kind: 'document', folderId: FOLDER_ID }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.document.id).toBe(DOC_ID)
    expect(statements[2]).toContain('INSERT INTO documents')
  })

  it('embeds a non-blank new document and writes content_text + embedding', async () => {
    sqlQueue = [
      [{ id: USER_ID }],
      [{ id: DOC_ID, folder_id: null, title: 'Roadmap', blocks: [] }],
    ]
    const embedHandler = createHandler({
      verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
      getSql,
      allowRequest: vi.fn(async () => true),
      embedText: vi.fn(async () => [0.1, 0.2]),
      embedTextCached: vi.fn(),
    })
    const res = makeRes()

    await embedHandler(req('POST', { kind: 'document', title: 'Roadmap' }), res)

    expect(res.statusCode).toBe(201)
    expect(statements[1]).toContain('embedding')
    expect(statements[1]).toContain('::extensions.vector')
    expect(statements[1]).toContain('content_text')
  })

  it('skips embedding for a blank new document without calling allowRequest', async () => {
    sqlQueue = [[{ id: USER_ID }], [{ id: DOC_ID, folder_id: null, title: '', blocks: [] }]]
    const denyIfCalled = vi.fn(async () => {
      throw new Error('allowRequest should not be called for a blank document')
    })
    const embedHandler = createHandler({
      verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
      getSql,
      allowRequest: denyIfCalled,
      embedText: vi.fn(),
      embedTextCached: vi.fn(),
    })
    const res = makeRes()

    await embedHandler(req('POST', { kind: 'document', folderId: null }), res)

    expect(res.statusCode).toBe(201)
    expect(denyIfCalled).not.toHaveBeenCalled()
    expect(statements[1]).not.toContain('embedding')
  })

  it('rejects a folderId the caller does not own', async () => {
    sqlQueue = [[{ id: USER_ID }], []]
    const res = makeRes()

    await handler(req('POST', { kind: 'document', folderId: FOLDER_ID }), res)

    expect(res.statusCode).toBe(400)
    expect(statements.some((s) => s.includes('INSERT'))).toBe(false)
  })

  it('creates a nested folder', async () => {
    sqlQueue = [
      [{ id: USER_ID }],
      [{ id: FOLDER_ID }],
      [{ id: 'new-folder', parent_id: FOLDER_ID, title: 'Sprint Planning' }],
    ]
    const res = makeRes()

    await handler(
      req('POST', { kind: 'folder', title: 'Sprint Planning', parentId: FOLDER_ID }),
      res,
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.folder.title).toBe('Sprint Planning')
  })

  it('requires a folder title', async () => {
    sqlQueue = [[{ id: USER_ID }]]
    const res = makeRes()

    await handler(req('POST', { kind: 'folder', title: '   ' }), res)

    expect(res.statusCode).toBe(400)
  })

  it('rejects an unknown kind', async () => {
    sqlQueue = [[{ id: USER_ID }]]
    const res = makeRes()

    await handler(req('POST', { kind: 'widget' }), res)

    expect(res.statusCode).toBe(400)
  })

  it('creates a reusable document template', async () => {
    sqlQueue = [
      [{ id: USER_ID }],
      [{ id: TEMPLATE_ID, title: 'Meeting notes', blocks: [{ type: 'header' }] }],
    ]
    const res = makeRes()

    await handler(
      req('POST', {
        kind: 'template',
        title: 'Meeting notes',
        blocks: [{ type: 'header', data: { text: 'Agenda' } }],
      }),
      res,
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.template.id).toBe(TEMPLATE_ID)
    expect(statements[1]).toContain('INSERT INTO document_templates')
  })

  it('creates a document by copying an owned template', async () => {
    sqlQueue = [
      [{ id: USER_ID }],
      [{ id: TEMPLATE_ID, title: 'Meeting notes', emoji: '📄', blocks: [{ type: 'header' }] }],
      [{ id: DOC_ID, title: 'Meeting notes', emoji: '📄', blocks: [{ type: 'header' }] }],
    ]
    const res = makeRes()

    await handler(req('POST', { kind: 'document', templateId: TEMPLATE_ID }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.document.title).toBe('Meeting notes')
    expect(statements[1]).toContain('document_templates')
    expect(statements[2]).toContain('INSERT INTO documents')
  })

  it('rejects a template the caller does not own', async () => {
    sqlQueue = [[{ id: USER_ID }], []]
    const res = makeRes()

    await handler(req('POST', { kind: 'document', templateId: TEMPLATE_ID }), res)

    expect(res.statusCode).toBe(400)
    expect(statements.some((statement) => statement.includes('INSERT INTO documents'))).toBe(false)
  })
})

describe('PATCH /api/tasks?resource=documents', () => {
  it('saves blocks through sql.json and bumps updated_at', async () => {
    // A blocks-only update first re-fetches the current title (content_text
    // needs the full title+blocks text even though only blocks changed here),
    // then the previous row again (to diff against for daily-note event
    // sync) before the UPDATE itself.
    sqlQueue = [
      [{ title: 'Notes', blocks: [] }],
      [{ folder_id: null, title: 'Notes', blocks: [] }],
      [{ id: DOC_ID, title: 'Notes', folder_id: null }],
    ]
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, blocks: [{ type: 'paragraph', data: {} }] }), res)

    expect(res.statusCode).toBe(200)
    expect(statements[1]).toContain('folder_id')
    expect(statements[2]).toBe('SET(blocks,content_text)')
    expect(statements[3]).toContain('updated_at = now()')
  })

  it('syncs a Daily note time-range line into a linked calendar event', async () => {
    sqlQueue = [
      [{ title: '14-08-26', blocks: [] }], // effective-title pre-fetch
      [{ folder_id: FOLDER_ID, title: '14-08-26', blocks: [] }], // previous row
      [{ id: DOC_ID, title: '14-08-26', folder_id: FOLDER_ID }], // UPDATE ... RETURNING
      [{ title: 'Daily' }], // resolveDailyNoteEventDate's folder-ancestry root
      [{ id: 'cal-personal' }], // resolveDefaultCalendarId
      [], // the upsert itself
    ]
    const res = makeRes()

    await handler(
      req('PATCH', {
        id: DOC_ID,
        blocks: [{ id: 'block-1', type: 'paragraph', data: { text: '10:00 - 11:00 - Team sync' } }],
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    // [0] effective-title pre-fetch, [1] previous-row SELECT, [2] SET(...)
    // helper, [3] the UPDATE itself, [4] resolveDailyNoteEventDate's
    // folder-ancestry CTE, [5] the default calendar lookup, [6] the
    // calendar_events upsert.
    expect(statements).toHaveLength(7)
    expect(statements[4]).toContain('ancestry')
    expect(statements[5]).toContain('FROM calendars')
    expect(statements[6]).toContain('ON CONFLICT (source_document_id, source_block_id)')
  })

  it('syncs a time-range line inside a bulleted/checklist list item', async () => {
    sqlQueue = [
      [{ title: '14-08-26', blocks: [] }],
      [{ folder_id: FOLDER_ID, title: '14-08-26', blocks: [] }],
      [{ id: DOC_ID, title: '14-08-26', folder_id: FOLDER_ID }],
      [{ title: 'Daily' }],
      [{ id: 'cal-personal' }],
      [],
    ]
    const res = makeRes()

    await handler(
      req('PATCH', {
        id: DOC_ID,
        blocks: [
          {
            id: 'list-1',
            type: 'list',
            data: {
              style: 'checklist',
              items: [
                { content: '09:00 - Standup', meta: { checked: false } },
                { content: 'Plain task, no time', meta: { checked: false } },
              ],
            },
          },
        ],
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(statements).toHaveLength(7)
    expect(statements[6]).toContain('ON CONFLICT (source_document_id, source_block_id)')
  })

  it('does not touch calendar_events for a non-Daily document\'s blocks', async () => {
    sqlQueue = [
      [{ title: 'Notes', blocks: [] }],
      [{ folder_id: FOLDER_ID, title: 'Notes', blocks: [] }],
      [{ id: DOC_ID, title: 'Notes', folder_id: FOLDER_ID }],
    ]
    const res = makeRes()

    await handler(
      req('PATCH', {
        id: DOC_ID,
        blocks: [{ id: 'block-1', type: 'paragraph', data: { text: '10:00 - 11:00 - Team sync' } }],
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    // No folder-ancestry lookup: 'Notes' doesn't parse as a daily-note title,
    // so resolveDailyNoteEventDate short-circuits before it needs one.
    expect(statements).toHaveLength(4)
  })

  it('re-embeds and writes the new vector when the save is allowed', async () => {
    sqlQueue = [
      [{ title: 'Notes', blocks: [] }], // effective-title pre-fetch
      [{ folder_id: null, title: 'Notes', blocks: [] }], // previous row (daily-note diff)
      [{ id: DOC_ID, title: 'Notes', folder_id: null }], // UPDATE ... RETURNING
    ]
    const embedHandler = createHandler({
      verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
      getSql,
      allowRequest: vi.fn(async () => true),
      embedText: vi.fn(async () => [0.1, 0.2]),
      embedTextCached: vi.fn(),
    })
    const res = makeRes()

    await embedHandler(
      req('PATCH', { id: DOC_ID, blocks: [{ type: 'paragraph', data: { text: 'Ship it' } }] }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(statements[3]).toContain('embedding')
    expect(statements[3]).toContain('::extensions.vector')
  })

  it('fetches the current blocks to embed a title-only rename', async () => {
    sqlQueue = [
      [{ title: 'Old title', blocks: [{ type: 'paragraph', data: { text: 'Body text' } }] }],
      [{ id: DOC_ID, title: 'New title' }],
    ]
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, title: 'New title' }), res)

    expect(res.statusCode).toBe(200)
    // No transaction-scoped `previous` row: only a title rename, no blocks
    // touched, so the daily-note-event diff has nothing to do.
    expect(statements[0]).toContain('SELECT title, blocks')
    expect(statements[1]).toBe('SET(title,content_text)')
  })

  it('404s a title/blocks-touching patch for a document the caller does not own', async () => {
    sqlQueue = [[]] // effective-title pre-fetch finds nothing
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, title: 'New title' }), res)

    expect(res.statusCode).toBe(404)
    expect(statements).toHaveLength(1)
  })

  it('toggles starred', async () => {
    sqlQueue = [[{ id: DOC_ID, starred: true }]]
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, starred: true }), res)

    expect(res.statusCode).toBe(200)
    expect(statements[0]).toBe('SET(starred)')
  })

  it('moves a document to the root with folderId null', async () => {
    sqlQueue = [[{ id: DOC_ID, folder_id: null }]]
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, folderId: null }), res)

    expect(res.statusCode).toBe(200)
    expect(statements[0]).toBe('SET(folder_id)')
  })

  it('normalizes and saves document tags', async () => {
    sqlQueue = [[{ id: DOC_ID, tags: ['project-one', 'home'] }]]
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, tags: ['#Project-One', 'home', 'HOME'] }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.document.tags).toEqual(['project-one', 'home'])
    expect(statements[0]).toBe('SET(tags)')
  })

  it('rejects invalid document tags', async () => {
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, tags: ['two words'] }), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })

  it('rejects non-array blocks', async () => {
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, blocks: 'nope' }), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })

  it('rejects an empty update', async () => {
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID }), res)

    expect(res.statusCode).toBe(400)
  })

  it('renames a folder', async () => {
    sqlQueue = [[{ id: FOLDER_ID, title: 'Renamed' }]]
    const res = makeRes()

    await handler(req('PATCH', { kind: 'folder', id: FOLDER_ID, title: 'Renamed' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.folder.title).toBe('Renamed')
  })

  it('404s a document the caller does not own', async () => {
    sqlQueue = [[]]
    const res = makeRes()

    await handler(req('PATCH', { id: DOC_ID, title: 'Stolen' }), res)

    expect(res.statusCode).toBe(404)
  })

  it('updates an owned template title and blocks together', async () => {
    sqlQueue = [[{ id: TEMPLATE_ID, title: 'Weekly notes', blocks: [{ type: 'list' }] }]]
    const res = makeRes()

    await handler(
      req('PATCH', {
        kind: 'template',
        id: TEMPLATE_ID,
        title: 'Weekly notes',
        blocks: [{ type: 'list', data: { items: [] } }],
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.template.title).toBe('Weekly notes')
    expect(statements[0]).toContain('UPDATE document_templates')
  })
})

describe('DELETE /api/tasks?resource=documents', () => {
  it('deletes an owned document', async () => {
    sqlQueue = [[{ id: DOC_ID }]]
    const res = makeRes()

    await handler(req('DELETE', { kind: 'document', id: DOC_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(statements[0]).toContain('DELETE FROM documents')
  })

  it('deletes an owned folder', async () => {
    sqlQueue = [[{ id: FOLDER_ID }]]
    const res = makeRes()

    await handler(req('DELETE', { kind: 'folder', id: FOLDER_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(statements[0]).toContain('DELETE FROM document_folders')
  })

  it('404s an id the caller does not own', async () => {
    sqlQueue = [[]]
    const res = makeRes()

    await handler(req('DELETE', { kind: 'document', id: DOC_ID }), res)

    expect(res.statusCode).toBe(404)
  })

  it('deletes an owned template', async () => {
    sqlQueue = [[{ id: TEMPLATE_ID }]]
    const res = makeRes()

    await handler(req('DELETE', { kind: 'template', id: TEMPLATE_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(statements[0]).toContain('DELETE FROM document_templates')
  })
})

describe('method gate', () => {
  it('allows PATCH only for the documents resource', async () => {
    const res = makeRes()
    await handler({ method: 'PATCH', url: '/api/tasks', headers: {}, body: {} }, res)
    expect(res.statusCode).toBe(405)
  })
})

describe('normalizeBlocks', () => {
  it('accepts an array of objects', () => {
    expect(normalizeBlocks([{ type: 'paragraph' }])).toEqual([{ type: 'paragraph' }])
  })

  it('rejects non-arrays and arrays holding non-objects', () => {
    expect(normalizeBlocks('nope')).toBeNull()
    expect(normalizeBlocks([{ ok: 1 }, 'nope'])).toBeNull()
    expect(normalizeBlocks([null])).toBeNull()
  })

  it('rejects a payload over the size cap', () => {
    const oversized = [{ type: 'image', data: { url: 'x'.repeat(MAX_BLOCKS_BYTES) } }]
    expect(normalizeBlocks(oversized)).toBeNull()
  })
})

describe('cleanText', () => {
  it('trims and bounds strings, and rejects non-strings', () => {
    expect(cleanText('  hi  ', 10)).toBe('hi')
    expect(cleanText('abcdef', 3)).toBe('abc')
    expect(cleanText(42, 10)).toBeNull()
  })
})
