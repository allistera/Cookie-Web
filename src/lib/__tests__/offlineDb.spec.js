import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CACHE_STORE, OUTBOX_STORE, createOfflineDb } from '../offlineDb'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createOfflineDb', () => {
  it('stores, lists, deletes and clears values', async () => {
    const db = createOfflineDb({ indexedDB: new IDBFactory() })

    await db.put(CACHE_STORE, { value: 1 }, 'a')
    await db.put(CACHE_STORE, { value: 2 }, 'b')
    expect(await db.get(CACHE_STORE, 'a')).toEqual({ value: 1 })
    expect(await db.get(CACHE_STORE, 'missing')).toBeNull()
    expect(await db.getAll(CACHE_STORE)).toEqual([{ value: 1 }, { value: 2 }])

    await db.delete(CACHE_STORE, 'a')
    expect(await db.getAll(CACHE_STORE)).toEqual([{ value: 2 }])

    await db.clear(CACHE_STORE)
    expect(await db.getAll(CACHE_STORE)).toEqual([])
  })

  it('numbers outbox entries in insertion order and returns the key', async () => {
    const db = createOfflineDb({ indexedDB: new IDBFactory() })

    const first = await db.put(OUTBOX_STORE, { kind: 'a' })
    const second = await db.put(OUTBOX_STORE, { kind: 'b' })
    expect(second).toBeGreaterThan(first)
    expect((await db.getAll(OUTBOX_STORE)).map((entry) => entry.kind)).toEqual(['a', 'b'])

    // Rewriting an entry under its own seq keeps its place.
    await db.put(OUTBOX_STORE, { seq: first, kind: 'a2' })
    expect((await db.getAll(OUTBOX_STORE)).map((entry) => entry.kind)).toEqual(['a2', 'b'])

    await db.clearAll()
    expect(await db.getAll(OUTBOX_STORE)).toEqual([])
  })

  it('keeps separate databases apart', async () => {
    const indexedDB = new IDBFactory()
    const one = createOfflineDb({ indexedDB, name: 'one' })
    const two = createOfflineDb({ indexedDB, name: 'two' })

    await one.put(CACHE_STORE, { value: 1 }, 'k')
    expect(await two.get(CACHE_STORE, 'k')).toBeNull()
  })

  it('answers null and empty lists when IndexedDB is unavailable', async () => {
    const db = createOfflineDb({ indexedDB: null })

    expect(await db.put(CACHE_STORE, { value: 1 }, 'a')).toBeNull()
    expect(await db.get(CACHE_STORE, 'a')).toBeNull()
    expect(await db.getAll(CACHE_STORE)).toEqual([])
    expect(await db.delete(CACHE_STORE, 'a')).toBeNull()
  })

  it('answers null when the database refuses to open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const indexedDB = {
      open() {
        throw new Error('blocked')
      },
    }
    const db = createOfflineDb({ indexedDB })

    expect(await db.get(CACHE_STORE, 'a')).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })
})
