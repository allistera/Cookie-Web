import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearOfflineData,
  readOfflineCache,
  removeOfflineCache,
  setOfflineOwner,
  writeOfflineCache,
  writeRecentOfflineCache,
} from '../offlineCache'
import { CACHE_STORE, createOfflineDb, setOfflineDb } from '../offlineDb'

let db

beforeEach(() => {
  db = createOfflineDb({ indexedDB: new IDBFactory() })
  setOfflineDb(db)
  setOfflineOwner('auth0|alice')
})

afterEach(() => {
  setOfflineDb(null)
  setOfflineOwner(null)
  vi.restoreAllMocks()
})

describe('offline cache', () => {
  it('round-trips a value with the time it was saved', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)

    await writeOfflineCache('labels', [{ name: 'Home' }])

    expect(await readOfflineCache('labels')).toEqual({ value: [{ name: 'Home' }], savedAt: 1_000 })
    expect(await readOfflineCache('categories')).toBeNull()
  })

  it('keeps each account to its own entries', async () => {
    await writeOfflineCache('labels', ['alice'])
    setOfflineOwner('auth0|bob')

    expect(await readOfflineCache('labels')).toBeNull()
    await writeOfflineCache('labels', ['bob'])
    expect((await db.getAll(CACHE_STORE)).map((entry) => entry.value)).toEqual([['alice'], ['bob']])
  })

  it('files a response under the account that asked for it, not the one now signed in', async () => {
    const owner = 'auth0|alice'
    setOfflineOwner('auth0|bob')

    await writeOfflineCache('inbox:page', { emails: ['alice mail'] }, owner)

    expect(await readOfflineCache('inbox:page')).toBeNull()
    expect((await readOfflineCache('inbox:page', owner)).value).toEqual({ emails: ['alice mail'] })
  })

  it('stores a plain copy, so reactive input and later mutation do not leak in', async () => {
    const value = { rows: [{ id: 1 }] }
    await writeOfflineCache('page', value)
    value.rows.push({ id: 2 })

    expect((await readOfflineCache('page')).value).toEqual({ rows: [{ id: 1 }] })
  })

  it('never throws for a value that cannot be serialized', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cyclic = {}
    cyclic.self = cyclic

    await expect(writeOfflineCache('page', cyclic)).resolves.toBeUndefined()
    expect(await readOfflineCache('page')).toBeNull()
  })

  it('bounds a recent-items cache, evicting the oldest', async () => {
    for (const id of ['a', 'b', 'c']) {
      await writeRecentOfflineCache('recent', `doc:${id}`, { id }, 2)
    }

    expect(await readOfflineCache('doc:a')).toBeNull()
    expect((await readOfflineCache('doc:b')).value).toEqual({ id: 'b' })
    expect((await readOfflineCache('doc:c')).value).toEqual({ id: 'c' })
    expect((await readOfflineCache('recent')).value).toEqual(['doc:b', 'doc:c'])

    // Re-caching an item moves it to the newest slot.
    await writeRecentOfflineCache('recent', 'doc:b', { id: 'b2' }, 2)
    await writeRecentOfflineCache('recent', 'doc:d', { id: 'd' }, 2)
    expect(await readOfflineCache('doc:c')).toBeNull()
    expect((await readOfflineCache('doc:b')).value).toEqual({ id: 'b2' })
  })

  it('removes one entry, or everything on sign-out', async () => {
    await writeOfflineCache('labels', [])
    await writeOfflineCache('page', {})

    await removeOfflineCache('labels')
    expect(await readOfflineCache('labels')).toBeNull()
    expect(await readOfflineCache('page')).not.toBeNull()

    await clearOfflineData()
    expect(await readOfflineCache('page')).toBeNull()
  })
})
