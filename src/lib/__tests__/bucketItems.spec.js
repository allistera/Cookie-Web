import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BUCKET_DEFAULT_ICON,
  bucketExpiryLabel,
  bucketItemKey,
  bucketItemRoute,
  bucketItemSubtitle,
  documentBucketItem,
  emailBucketItem,
  eventBucketItem,
  parseBucket,
  readBucket,
  taskBucketItem,
  writeBucket,
} from '../bucketItems'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Tuesday 13 October 2026, 09:50 local time.
const NOW = new Date(2026, 9, 13, 9, 50)

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('items from what each app has open', () => {
  it('takes an email’s subject, sender and send time', () => {
    const item = emailBucketItem({
      id: 'msg-1',
      subject: ' Re: Acme MSA ',
      sender: 'Jamie Reid',
      sentAt: '2026-10-13T08:42:00.000Z',
      body: 'never copied',
    })
    expect(item).toEqual({
      kind: 'email',
      id: 'msg-1',
      title: 'Re: Acme MSA',
      meta: { sender: 'Jamie Reid', sentAt: '2026-10-13T08:42:00.000Z' },
    })
    expect(emailBucketItem({ id: 'msg-2', subject: '' }).title).toBe('(no subject)')
    expect(emailBucketItem(null)).toBeNull()
  })

  it('takes a document’s title and last edit', () => {
    expect(
      documentBucketItem({ id: 'doc-1', title: 'Acme MSA v3', updated_at: '2026-10-13T08:00:00Z' }),
    ).toEqual({
      kind: 'document',
      id: 'doc-1',
      title: 'Acme MSA v3',
      meta: { updatedAt: '2026-10-13T08:00:00Z' },
    })
    expect(documentBucketItem({ id: 'doc-2', title: '  ' }).title).toBe('Untitled')
  })

  it('takes a task’s content, project and due date', () => {
    expect(
      taskBucketItem(
        { id: 'task-1', content: 'Send signed MSA', projectId: 'p1', dueDate: '2026-10-16' },
        'Work',
      ),
    ).toEqual({
      kind: 'task',
      id: 'task-1',
      title: 'Send signed MSA',
      meta: { projectId: 'p1', projectName: 'Work', dueDate: '2026-10-16' },
    })
    const inboxTask = taskBucketItem({
      id: 'task-2',
      content: 'Call',
      projectId: null,
      dueDate: 'soon',
    })
    expect(inboxTask.meta).toEqual({ projectId: null, projectName: 'Inbox', dueDate: null })
  })

  it('takes an event’s title, day and time', () => {
    expect(
      eventBucketItem({
        id: 'ev-1',
        title: 'Acme legal sync',
        date: '2026-10-15',
        start: '14:00',
        duration: 30,
      }),
    ).toEqual({
      kind: 'event',
      id: 'ev-1',
      title: 'Acme legal sync',
      meta: { date: '2026-10-15', start: '14:00', duration: 30, allDay: false },
    })
    expect(eventBucketItem({ id: 'ev-2', title: 'No day' })).toBeNull()
  })
})

describe('opening an item again', () => {
  it('routes each kind to where it is shown', () => {
    expect(bucketItemRoute({ kind: 'email', id: 'msg-1' })).toEqual({
      path: '/inbox',
      query: { open: 'msg-1' },
    })
    expect(bucketItemRoute({ kind: 'document', id: 'doc 1' })).toEqual({
      path: '/documents/doc%201',
    })
    expect(bucketItemRoute({ kind: 'task', id: 't1', meta: { projectId: 'p1' } })).toEqual({
      path: '/tasks',
      query: { project: 'p1', task: 't1' },
    })
    expect(bucketItemRoute({ kind: 'task', id: 't2', meta: { projectId: null } })).toEqual({
      path: '/tasks',
      query: { project: 'inbox', task: 't2' },
    })
    expect(bucketItemRoute({ kind: 'event', id: 'ev', meta: { date: '2026-10-15' } })).toEqual({
      path: '/calendar',
      query: { date: '2026-10-15', event: 'ev' },
    })
  })

  it('keys items by kind and id', () => {
    expect(bucketItemKey({ kind: 'task', id: '7' })).toBe('task:7')
  })
})

describe('second lines', () => {
  it('shows an email’s sender with its time today and its day otherwise', () => {
    const today = new Date(2026, 9, 13, 9, 42).toISOString()
    expect(
      bucketItemSubtitle({ kind: 'email', meta: { sender: 'Jamie Reid', sentAt: today } }, NOW),
    ).toBe('Jamie Reid · 09:42')
    const earlier = new Date(2026, 6, 25, 9, 42).toISOString()
    expect(
      bucketItemSubtitle({ kind: 'email', meta: { sender: 'Jamie', sentAt: earlier } }, NOW),
    ).toMatch(/^Jamie · 25 Jul$/)
  })

  it('shows how long ago a document was edited', () => {
    const subtitle = (updatedAt) =>
      bucketItemSubtitle({ kind: 'document', meta: { updatedAt } }, NOW)
    expect(subtitle(new Date(NOW.getTime() - 30_000).toISOString())).toBe(
      'Documents · edited just now',
    )
    expect(subtitle(new Date(NOW.getTime() - 5 * 60_000).toISOString())).toBe(
      'Documents · edited 5 min ago',
    )
    expect(subtitle(new Date(NOW.getTime() - HOUR).toISOString())).toBe('Documents · edited 1h ago')
    expect(subtitle(new Date(NOW.getTime() - 2 * DAY).toISOString())).toBe(
      'Documents · edited 2 days ago',
    )
    expect(subtitle('')).toBe('Documents')
  })

  it('shows a task’s project and a relative due day', () => {
    const subtitle = (dueDate) =>
      bucketItemSubtitle({ kind: 'task', meta: { projectName: 'Work', dueDate } }, NOW)
    expect(subtitle('2026-10-13')).toBe('Work · due today')
    expect(subtitle('2026-10-14')).toBe('Work · due tomorrow')
    expect(subtitle('2026-10-16')).toBe('Work · due Fri')
    expect(subtitle('2026-11-02')).toMatch(/^Work · due 2 Nov$/)
    expect(subtitle(null)).toBe('Work')
  })

  it('shows an event’s day with its start and end', () => {
    expect(
      bucketItemSubtitle(
        {
          kind: 'event',
          meta: { date: '2026-10-15', start: '14:00', duration: 30, allDay: false },
        },
        NOW,
      ),
    ).toBe('Thu 14:00-14:30')
    expect(
      bucketItemSubtitle(
        { kind: 'event', meta: { date: '2026-10-13', start: '', allDay: true } },
        NOW,
      ),
    ).toBe('today · all day')
  })
})

describe('the clearing time', () => {
  it('reads in days, hours or minutes', () => {
    const now = NOW.getTime()
    expect(bucketExpiryLabel(now + 3 * DAY, now)).toBe('Clears in 3 days')
    expect(bucketExpiryLabel(now + 3 * DAY - HOUR, now)).toBe('Clears in 3 days')
    expect(bucketExpiryLabel(now + DAY, now)).toBe('Clears in 1 day')
    expect(bucketExpiryLabel(now + 5 * HOUR, now)).toBe('Clears in 5 hours')
    expect(bucketExpiryLabel(now + HOUR, now)).toBe('Clears in 1 hour')
    expect(bucketExpiryLabel(now + 20 * 60_000, now)).toBe('Clears in 20 min')
    expect(bucketExpiryLabel(now, now)).toBe('Clears now')
    expect(bucketExpiryLabel(undefined, now)).toBe('Clears now')
  })
})

describe('storage', () => {
  const stored = {
    owner: 'auth0|me',
    title: 'Acme contract review',
    icon: 'ms:work',
    createdAt: 1,
    expiresAt: 2,
    items: [{ kind: 'email', id: 'msg-1', title: 'Re: Acme', meta: { sender: 'Jamie' } }],
  }

  it('round-trips a bucket for its owner only', () => {
    writeBucket(stored)
    expect(readBucket('auth0|me')).toEqual(stored)
    expect(readBucket('auth0|someone-else')).toBeNull()
    writeBucket(null)
    expect(readBucket('auth0|me')).toBeNull()
  })

  it('drops items that do not read as one, and duplicates', () => {
    const bucket = parseBucket(
      {
        ...stored,
        icon: '',
        items: [
          ...stored.items,
          { kind: 'email', id: 'msg-1', title: 'twice' },
          { kind: 'note', id: 'x' },
          { kind: 'task' },
          'junk',
          { kind: 'task', id: 't1', meta: ['not', 'an', 'object'] },
        ],
      },
      'auth0|me',
    )
    expect(bucket.icon).toBe(BUCKET_DEFAULT_ICON)
    expect(bucket.items).toEqual([stored.items[0], { kind: 'task', id: 't1', title: '', meta: {} }])
  })

  it('ignores a record without times, and junk in storage', () => {
    expect(parseBucket({ ...stored, expiresAt: 'never' }, 'auth0|me')).toBeNull()
    expect(parseBucket([], 'auth0|me')).toBeNull()
    localStorage.setItem('cookie.bucket', '{not json')
    expect(readBucket('auth0|me')).toBeNull()
  })
})
