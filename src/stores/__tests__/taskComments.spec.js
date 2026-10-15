import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInboxStore } from '../inbox'
import { useTaskCommentsStore } from '../taskComments'

const TASK = 't1'
const COMMENT = {
  id: 'c1',
  taskId: TASK,
  body: 'First',
  attachment: null,
  mine: true,
  editedAt: null,
  createdAt: '2026-10-15T09:00:00Z',
  updatedAt: '2026-10-15T09:00:00Z',
}

let store
let notify

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskCommentsStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  notify = vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

function ok(payload, status = 200) {
  return { ok: true, status, json: async () => payload }
}

describe('task comments store', () => {
  it('loads a thread once and keeps it for a reopened task', async () => {
    stubFetch(async () => ok({ comments: [COMMENT], nextCursor: null }))

    await store.loadThread(TASK)
    await store.loadThread(TASK)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/\/task-comments\?task=t1$/)
    expect(store.thread(TASK).comments).toEqual([COMMENT])
    expect(store.thread(TASK).loaded).toBe(true)
  })

  it('continues past the cursor and drops rows already shown', async () => {
    const second = { ...COMMENT, id: 'c2' }
    stubFetch(async (url) =>
      String(url).includes('after=')
        ? ok({ comments: [COMMENT, second], nextCursor: null })
        : ok({ comments: [COMMENT], nextCursor: 'cur' }),
    )

    await store.loadThread(TASK)
    await store.loadThread(TASK, { more: true })

    expect(fetch.mock.calls[1][0]).toMatch(/after=cur/)
    expect(store.thread(TASK).comments.map((row) => row.id)).toEqual(['c1', 'c2'])
    expect(store.thread(TASK).nextCursor).toBeNull()
  })

  it('keeps the server error on the thread and leaves it retryable', async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Down' }) }))

    await store.loadThread(TASK)

    expect(store.thread(TASK).error).toBe('Down')
    expect(store.thread(TASK).loaded).toBe(false)
    stubFetch(async () => ok({ comments: [], nextCursor: null }))
    await store.loadThread(TASK)
    expect(store.thread(TASK).loaded).toBe(true)
    expect(store.thread(TASK).error).toBeNull()
  })

  it('posts a multipart entry and appends what the server returns', async () => {
    stubFetch(async () => ok({ comment: COMMENT }, 201))
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' })

    const saved = await store.addComment(TASK, { body: ' First ', file })

    expect(saved).toEqual(COMMENT)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toMatch(/\/task-comments$/)
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('task')).toBe(TASK)
    expect(options.body.get('body')).toBe('First')
    expect(options.body.get('file')).toBe(file)
    expect(store.thread(TASK).comments).toEqual([COMMENT])
  })

  it('reports a refused entry with the server message and adds nothing', async () => {
    stubFetch(async () => ({ ok: false, status: 413, json: async () => ({ error: 'Too big' }) }))

    const saved = await store.addComment(TASK, { body: 'x' })

    expect(saved).toBeNull()
    expect(notify).toHaveBeenCalledWith('Too big', 'error')
    expect(store.thread(TASK).comments).toEqual([])
  })

  it('replaces an edited entry in place', async () => {
    store.threads[TASK] = {
      comments: [COMMENT, { ...COMMENT, id: 'c2' }],
      nextCursor: null,
      loaded: true,
      loading: false,
      error: null,
    }
    const edited = { ...COMMENT, body: 'Changed', editedAt: '2026-10-15T10:00:00Z' }
    stubFetch(async () => ok({ comment: edited }))

    await store.editComment(TASK, 'c1', 'Changed')

    const [, options] = fetch.mock.calls[0]
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ body: 'Changed' })
    expect(store.thread(TASK).comments[0]).toEqual(edited)
    expect(store.thread(TASK).comments[1].id).toBe('c2')
  })

  it('sends attachment: null to take the file off an entry', async () => {
    store.threads[TASK] = {
      comments: [{ ...COMMENT, attachment: { name: 'a.pdf' } }],
      nextCursor: null,
      loaded: true,
      loading: false,
      error: null,
    }
    stubFetch(async () => ok({ comment: COMMENT }))

    await store.removeAttachment(TASK, 'c1')

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ attachment: null })
    expect(store.thread(TASK).comments[0].attachment).toBeNull()
  })

  it('removes a deleted entry at once and puts it back when the server refuses', async () => {
    store.threads[TASK] = {
      comments: [COMMENT, { ...COMMENT, id: 'c2' }],
      nextCursor: null,
      loaded: true,
      loading: false,
      error: null,
    }
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Down' }) }))

    const deleted = await store.deleteComment(TASK, 'c1')

    expect(deleted).toBe(false)
    expect(store.thread(TASK).comments.map((row) => row.id)).toEqual(['c1', 'c2'])
    expect(notify).toHaveBeenCalledWith('Down', 'error')

    stubFetch(async () => ({ ok: true, status: 204 }))
    expect(await store.deleteComment(TASK, 'c1')).toBe(true)
    expect(store.thread(TASK).comments.map((row) => row.id)).toEqual(['c2'])
  })

  it('fetches attachment bytes through the attachment route', async () => {
    const blob = new Blob(['x'])
    stubFetch(async () => ({ ok: true, blob: async () => blob }))

    await expect(store.fetchAttachmentBlob('c1')).resolves.toBe(blob)
    expect(fetch.mock.calls[0][0]).toMatch(/\/task-comments\/c1\/attachment$/)
  })

  it('forgets a thread so a stale id does not show old entries', async () => {
    store.threads[TASK] = {
      comments: [COMMENT],
      nextCursor: null,
      loaded: true,
      loading: false,
      error: null,
    }
    store.forgetThread(TASK)
    expect(store.thread(TASK).loaded).toBe(false)
    expect(store.thread(TASK).comments).toEqual([])
  })
})
