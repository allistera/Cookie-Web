import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BUCKET_DEFAULT_ICON, BUCKET_DEFAULT_TTL_MS } from '../../lib/bucketItems'
import { useBucketsStore } from '../buckets'

const DAY = 24 * 60 * 60 * 1000

const email = { kind: 'email', id: 'msg-1', title: 'Re: Acme MSA', meta: { sender: 'Jamie' } }
const task = { kind: 'task', id: 't1', title: 'Send signed MSA', meta: { projectName: 'Work' } }

function stored() {
  return JSON.parse(localStorage.getItem('cookie.bucket'))
}

let store

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  store = useBucketsStore()
  store.setOwner('auth0|me')
})

afterEach(() => localStorage.clear())

describe('pinning', () => {
  it('makes the bucket on the first pin and keeps it in localStorage', () => {
    expect(store.hasBucket).toBe(false)
    expect(store.togglePin(email)).toBe('pinned')
    expect(store.hasBucket).toBe(true)
    expect(store.bucket.icon).toBe(BUCKET_DEFAULT_ICON)
    expect(store.bucket.expiresAt - store.bucket.createdAt).toBe(BUCKET_DEFAULT_TTL_MS)
    expect(store.items).toEqual([email])
    expect(stored().items).toEqual([email])
    expect(stored().owner).toBe('auth0|me')
  })

  it('unpins an item pinned again, keeping the bucket', () => {
    store.togglePin(email)
    store.togglePin(task)
    expect(store.togglePin(email)).toBe('unpinned')
    expect(store.items).toEqual([task])
    expect(store.hasBucket).toBe(true)
  })

  it('pins whatever the showing view registered', () => {
    expect(store.pinCandidate()).toBeNull()
    store.setCandidate('view-1', email)
    expect(store.isCandidatePinned).toBe(false)
    expect(store.pinCandidate()).toBe('pinned')
    expect(store.isCandidatePinned).toBe(true)
  })

  it('does nothing without a signed-in account', () => {
    store.setOwner(null)
    expect(store.togglePin(email)).toBeNull()
    expect(store.hasBucket).toBe(false)
  })

  it('keeps its own copy of the item', () => {
    const candidate = { ...email, meta: { ...email.meta } }
    store.togglePin(candidate)
    candidate.title = 'renamed later'
    candidate.meta.sender = 'someone else'
    expect(store.items[0]).toEqual(email)
  })
})

describe('candidates', () => {
  it('only lets the view that set a candidate clear it', () => {
    store.setCandidate('view-1', email)
    store.setCandidate('view-2', task)
    store.clearCandidate('view-1')
    expect(store.candidate).toEqual(task)
    store.clearCandidate('view-2')
    expect(store.candidate).toBeNull()
  })
})

describe('editing', () => {
  beforeEach(() => store.togglePin(email))

  it('renames, changes the icon, removes items and persists each change', () => {
    store.rename('Acme contract review')
    store.setIcon('📁')
    expect(stored()).toMatchObject({ title: 'Acme contract review', icon: '📁' })
    store.setIcon('')
    expect(store.bucket.icon).toBe(BUCKET_DEFAULT_ICON)
    store.removeItem('email:msg-1')
    expect(store.items).toEqual([])
    expect(stored().items).toEqual([])
  })

  it('restarts the clock from now when the clearing time is picked', () => {
    store.setExpiry(DAY, 1_000)
    expect(store.bucket.expiresAt).toBe(1_000 + DAY)
    store.setExpiry(0, 2_000)
    expect(store.bucket.expiresAt).toBe(1_000 + DAY)
  })

  it('clears the whole bucket and can put it back', () => {
    store.open()
    const previous = store.clear()
    expect(store.hasBucket).toBe(false)
    expect(store.isOpen).toBe(false)
    expect(localStorage.getItem('cookie.bucket')).toBeNull()
    store.restore(previous)
    expect(store.items).toEqual([email])
    expect(stored().items).toEqual([email])
  })

  it('refuses to restore another account’s bucket', () => {
    const previous = store.clear()
    store.restore({ ...previous, owner: 'auth0|other' })
    expect(store.hasBucket).toBe(false)
  })
})

describe('clearing itself', () => {
  it('drops a bucket past its time, on load and when checked', () => {
    store.togglePin(email)
    const { expiresAt } = store.bucket
    expect(store.expireIfDue(expiresAt - 1)).toBe(false)
    expect(store.hasBucket).toBe(true)
    expect(store.expireIfDue(expiresAt)).toBe(true)
    expect(store.hasBucket).toBe(false)
    expect(localStorage.getItem('cookie.bucket')).toBeNull()
  })

  it('does not open a bucket that is past its time', () => {
    store.togglePin(email)
    store.bucket.expiresAt = Date.now() - 1
    store.open()
    expect(store.isOpen).toBe(false)
    expect(store.hasBucket).toBe(false)
  })
})

describe('accounts', () => {
  it('loads the stored bucket for the account signing in and drops it on sign-out', () => {
    store.togglePin(email)
    store.rename('Acme')
    setActivePinia(createPinia())
    const next = useBucketsStore()
    next.setOwner('auth0|me')
    expect(next.bucket.title).toBe('Acme')
    expect(next.items).toEqual([email])
    next.open()
    next.setOwner(null)
    expect(next.hasBucket).toBe(false)
    expect(next.isOpen).toBe(false)
    // Signing out leaves the record for the account's next sign-in.
    expect(stored().title).toBe('Acme')
  })

  it('shows another account nothing of this one’s bucket', () => {
    store.togglePin(email)
    store.setOwner('auth0|other')
    expect(store.hasBucket).toBe(false)
  })

  it('toggles its panel', () => {
    store.toggleOpen()
    expect(store.isOpen).toBe(false)
    store.togglePin(email)
    store.toggleOpen()
    expect(store.isOpen).toBe(true)
    store.toggleOpen()
    expect(store.isOpen).toBe(false)
  })
})
