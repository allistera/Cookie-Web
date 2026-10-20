import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isOnline,
  noteNetworkFailure,
  noteNetworkSuccess,
  resetConnectivityForTests,
} from '../connectivity'
import { setOfflineOwner } from '../offlineCache'
import { OUTBOX_STORE, createOfflineDb, setOfflineDb } from '../offlineDb'
import {
  enqueueOutbox,
  discardOutboxEntry,
  flushOutbox,
  installOutboxSync,
  outboxPending,
  outboxFailures,
  pendingOutboxEntries,
  registerOutboxHandler,
  resetOutboxForTests,
  retryOutboxEntry,
  syncOutbox,
} from '../outbox'

let db

beforeEach(() => {
  db = createOfflineDb({ indexedDB: new IDBFactory() })
  setOfflineDb(db)
  setOfflineOwner('auth0|alice')
  resetOutboxForTests()
  resetConnectivityForTests()
})

afterEach(() => {
  setOfflineDb(null)
  setOfflineOwner(null)
  vi.restoreAllMocks()
})

describe('enqueueOutbox', () => {
  it('queues changes in order and counts them', async () => {
    await enqueueOutbox({
      kind: 'message-patch',
      key: 'm1',
      payload: { id: 'm1', is_starred: true },
    })
    await enqueueOutbox({ kind: 'task-patch', key: 't1', payload: { id: 't1', content: 'x' } })

    expect(outboxPending.value).toBe(2)
    expect((await pendingOutboxEntries('message-patch')).map((entry) => entry.payload)).toEqual([
      { id: 'm1', is_starred: true },
    ])
  })

  it('merges a later change to the same key over the earlier one', async () => {
    await enqueueOutbox({
      kind: 'message-patch',
      key: 'm1',
      payload: { id: 'm1', is_starred: true },
    })
    await enqueueOutbox({
      kind: 'message-patch',
      key: 'm2',
      payload: { id: 'm2', is_unread: false },
    })
    await enqueueOutbox({
      kind: 'message-patch',
      key: 'm1',
      payload: { id: 'm1', is_starred: false, is_unread: false },
    })

    const entries = await db.getAll(OUTBOX_STORE)
    expect(entries.map((entry) => entry.payload)).toEqual([
      { id: 'm1', is_starred: false, is_unread: false },
      { id: 'm2', is_unread: false },
    ])
    expect(outboxPending.value).toBe(2)
  })

  it('keeps accounts apart', async () => {
    await enqueueOutbox({ kind: 'message-patch', key: 'm1', payload: { id: 'm1' } })
    setOfflineOwner('auth0|bob')

    expect(await pendingOutboxEntries('message-patch')).toEqual([])
    expect(await flushOutbox()).toEqual({ replayed: 0, dropped: 0, remaining: 0 })
    setOfflineOwner('auth0|alice')
    expect(await pendingOutboxEntries('message-patch')).toHaveLength(1)
  })
})

describe('flushOutbox', () => {
  it('replays in order and removes what was sent', async () => {
    const sent = []
    registerOutboxHandler('message-patch', async (payload) => {
      sent.push(payload)
    })
    await enqueueOutbox({
      kind: 'message-patch',
      key: 'm1',
      payload: { id: 'm1', is_starred: true },
    })
    await enqueueOutbox({
      kind: 'message-patch',
      key: 'm2',
      payload: { id: 'm2', is_unread: false },
    })

    expect(await flushOutbox()).toEqual({ replayed: 2, dropped: 0, remaining: 0 })
    expect(sent.map((payload) => payload.id)).toEqual(['m1', 'm2'])
    expect(await db.getAll(OUTBOX_STORE)).toEqual([])
    expect(outboxPending.value).toBe(0)
  })

  it('stops at a network failure and keeps the rest for next time', async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    registerOutboxHandler('message-patch', handler)
    for (const id of ['m1', 'm2', 'm3']) {
      await enqueueOutbox({ kind: 'message-patch', key: id, payload: { id } })
    }

    expect(await flushOutbox()).toEqual({ replayed: 1, dropped: 0, remaining: 2 })
    expect(handler).toHaveBeenCalledTimes(2)
    expect((await db.getAll(OUTBOX_STORE)).map((entry) => entry.key)).toEqual(['m2', 'm3'])
    expect(isOnline.value).toBe(false)
    expect(outboxPending.value).toBe(2)
  })

  it('retains a refused change for review while syncing independent changes', async () => {
    const refused = new Error('PATCH responded 404')
    refused.status = 404
    const handler = vi.fn().mockRejectedValueOnce(refused).mockResolvedValueOnce(undefined)
    registerOutboxHandler('message-patch', handler)
    await enqueueOutbox({ kind: 'message-patch', key: 'gone', payload: { id: 'gone' } })
    await enqueueOutbox({ kind: 'message-patch', key: 'm2', payload: { id: 'm2' } })

    expect(await flushOutbox()).toEqual({ replayed: 1, dropped: 0, remaining: 1 })
    const [entry] = await db.getAll(OUTBOX_STORE)
    expect(entry).toMatchObject({ key: 'gone', failure: 'blocked' })
    expect(outboxFailures.value).toHaveLength(1)
    await flushOutbox()
    expect(handler).toHaveBeenCalledTimes(2)
    await retryOutboxEntry(entry.seq)
    expect(handler).toHaveBeenCalledTimes(3)
    expect(await db.getAll(OUTBOX_STORE)).toEqual([])
  })

  it.each([429, 500, 503, 401])(
    'keeps a %s response durable and replays after recovery',
    async (status) => {
      const refusal = Object.assign(new Error('Temporarily refused'), { status })
      const handler = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValue(undefined)
      registerOutboxHandler('task-patch', handler)
      await enqueueOutbox({
        kind: 'task-patch',
        key: 't1',
        payload: { id: 't1', content: 'Keep this edit' },
      })
      expect(await flushOutbox()).toEqual({ replayed: 0, dropped: 0, remaining: 1 })
      expect((await db.getAll(OUTBOX_STORE))[0].payload.content).toBe('Keep this edit')
      expect(outboxFailures.value[0].failure).toBe(status === 401 ? 'authentication' : 'retry')
      expect(await flushOutbox()).toEqual({ replayed: 1, dropped: 0, remaining: 0 })
    },
  )

  it('requires an explicit discard and never discards another account’s entry', async () => {
    await enqueueOutbox({ kind: 'task-patch', key: 't1', payload: { id: 't1' } })
    const [{ seq }] = await db.getAll(OUTBOX_STORE)
    setOfflineOwner('auth0|bob')
    await discardOutboxEntry(seq)
    expect(await db.getAll(OUTBOX_STORE)).toHaveLength(1)
    setOfflineOwner('auth0|alice')
    await discardOutboxEntry(seq)
    expect(await db.getAll(OUTBOX_STORE)).toEqual([])
  })

  it('stops replay on account change without deleting the old account’s changes', async () => {
    let release
    const handler = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    registerOutboxHandler('task-patch', handler)
    await enqueueOutbox({ kind: 'task-patch', key: 't1', payload: { id: 't1' } })
    await enqueueOutbox({ kind: 'task-patch', key: 't2', payload: { id: 't2' } })
    const flushing = flushOutbox()
    await vi.waitFor(() => expect(release).toBeDefined())
    setOfflineOwner('auth0|bob')
    release()
    await flushing
    expect(handler).toHaveBeenCalledTimes(1)
    expect(await db.getAll(OUTBOX_STORE)).toHaveLength(2)
    expect(outboxPending.value).toBe(0)
  })

  it('keeps an entry whose handler has not registered yet', async () => {
    registerOutboxHandler('message-patch', vi.fn())
    await enqueueOutbox({ kind: 'document-patch', key: 'd1', payload: { id: 'd1' } })
    await enqueueOutbox({ kind: 'message-patch', key: 'm1', payload: { id: 'm1' } })

    expect(await flushOutbox()).toEqual({ replayed: 1, dropped: 0, remaining: 1 })
    expect((await db.getAll(OUTBOX_STORE)).map((entry) => entry.kind)).toEqual(['document-patch'])
  })

  it('runs one replay at a time', async () => {
    let release
    registerOutboxHandler('message-patch', () => new Promise((resolve) => (release = resolve)))
    await enqueueOutbox({ kind: 'message-patch', key: 'm1', payload: { id: 'm1' } })

    const first = flushOutbox()
    const second = flushOutbox()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(release).toBeDefined())
    release()
    expect(await first).toEqual({ replayed: 1, dropped: 0, remaining: 0 })
  })
})

describe('flushOutbox with edits during replay', () => {
  it('coalesces concurrent writes atomically without losing either field', async () => {
    await Promise.all([
      enqueueOutbox({ kind: 'task-patch', key: 't1', payload: { id: 't1', content: 'Title' } }),
      enqueueOutbox({ kind: 'task-patch', key: 't1', payload: { id: 't1', description: 'Notes' } }),
    ])
    const entries = await db.getAll(OUTBOX_STORE)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      revision: 2,
      payload: { content: 'Title', description: 'Notes' },
    })
  })
  it('keeps a change merged in while its request was in flight and sends it next', async () => {
    const sent = []
    let releaseFirst
    const handler = vi.fn(async (payload) => {
      sent.push({ ...payload })
      if (sent.length === 1) await new Promise((resolve) => (releaseFirst = resolve))
    })
    registerOutboxHandler('task-patch', handler)
    await enqueueOutbox({ kind: 'task-patch', key: 't1', payload: { id: 't1', content: 'A' } })

    const flush = flushOutbox()
    await vi.waitFor(() => expect(releaseFirst).toBeDefined())
    // Edited while "A" is on its way to the server.
    await enqueueOutbox({ kind: 'task-patch', key: 't1', payload: { id: 't1', content: 'B' } })
    releaseFirst()

    expect(await flush).toEqual({ replayed: 2, dropped: 0, remaining: 0 })
    expect(sent.map((payload) => payload.content)).toEqual(['A', 'B'])
    expect(await db.getAll(OUTBOX_STORE)).toEqual([])
  })

  it('rejects an enqueue the storage could not keep', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setOfflineDb(createOfflineDb({ indexedDB: null }))

    await expect(
      enqueueOutbox({ kind: 'message-patch', key: 'm1', payload: { id: 'm1' } }),
    ).rejects.toThrow(/Offline storage is unavailable/)
    expect(outboxPending.value).toBe(0)
  })
})

describe('syncOutbox and installOutboxSync', () => {
  it('loads handlers only when something is queued', async () => {
    const prepare = vi.fn(async () => registerOutboxHandler('message-patch', vi.fn()))

    expect(await syncOutbox({ prepare })).toEqual({ replayed: 0, dropped: 0, remaining: 0 })
    expect(prepare).not.toHaveBeenCalled()

    await enqueueOutbox({ kind: 'message-patch', key: 'm1', payload: { id: 'm1' } })
    expect(await syncOutbox({ prepare })).toEqual({ replayed: 1, dropped: 0, remaining: 0 })
    expect(prepare).toHaveBeenCalledOnce()
  })

  it('replays on reconnect and refreshes afterwards, and on a visible tab only when it sent something', async () => {
    const handler = vi.fn()
    registerOutboxHandler('message-patch', handler)
    const onSynced = vi.fn()
    const target = new EventTarget()
    target.visibilityState = 'visible'
    const stop = installOutboxSync({ target, onSynced })

    // Nothing queued: a visible tab stays quiet.
    target.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(onSynced).not.toHaveBeenCalled())

    await enqueueOutbox({ kind: 'message-patch', key: 'm1', payload: { id: 'm1' } })
    target.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1))

    // Reconnecting refreshes even with an empty queue: cached lists are stale.
    noteNetworkFailure()
    noteNetworkSuccess()
    await vi.waitFor(() => expect(onSynced).toHaveBeenCalledTimes(2))
    expect(handler).toHaveBeenCalledTimes(1)

    stop()
    noteNetworkFailure()
    noteNetworkSuccess()
    await Promise.resolve()
    expect(onSynced).toHaveBeenCalledTimes(2)
  })
})
