import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInboxStore } from '../inbox'
import { createOfflineDb, setOfflineDb } from '../../lib/offlineDb'
import { setOfflineOwner } from '../../lib/offlineCache'

let store
let db

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const email = (owner) => ({
  id: `${owner}-private`,
  from_address: `${owner}@example.com`,
  subject: `${owner}-private`,
  sent_at: '2026-10-20T09:00:00Z',
  is_unread: true,
})
const page = (owner) => ({
  emails: [email(owner)],
  userId: `${owner}-private`,
  unreadCount: 1,
  nextCursor: 'next-page',
})

function switchOwner(owner) {
  setOfflineOwner(owner)
  store.setComposeOwner(owner)
}

beforeEach(() => {
  db = createOfflineDb({ indexedDB: new IDBFactory() })
  setOfflineDb(db)
  setActivePinia(createPinia())
  store = useInboxStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(store, 'loadDraftRecoveries').mockResolvedValue()
  vi.spyOn(store, 'notify').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  switchOwner('alice')
})

afterEach(async () => {
  await vi.dynamicImportSettled()
  setOfflineOwner(null)
  setOfflineDb(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const loaders = [
  ['inbox', (store) => store.loadEmails(), page],
  ['inbox refresh', (store) => store.refreshInboxEmails(), page],
  ['inbox state', (store) => store.loadInboxState(), page],
  [
    'more inbox',
    (store) => {
      store.emailsCursor = 'next-page'
      return store.loadMoreEmails()
    },
    page,
  ],
  ['sent', (store) => store.loadSentEmails(), page],
  ['spam', (store) => store.loadSpamEmails(), page],
  ['snoozed', (store) => store.loadSnoozedEmails(), page],
  ['starred', (store) => store.loadStarredEmails(), page],
  ['label folder', (store) => store.loadLabelEmails('Work'), page],
  [
    'more spam',
    (store) => {
      store.spamCursor = 'next-page'
      return store.loadMoreSpamEmails()
    },
    page,
  ],
  ['done', (store) => store.loadDonePage(), page],
  ['search', (store) => store.searchEmails('query'), page],
  [
    'labels',
    (store) => store.loadLabels(),
    (owner) => ({ labels: [{ id: owner, name: `${owner}-private` }] }),
  ],
  [
    'categories',
    (store) => store.loadCategories(),
    (owner) => ({ categories: [{ id: owner, name: `${owner}-private` }] }),
  ],
  [
    'today',
    (store) => store.loadTasks(),
    (owner) => ({
      tasks: [{ id: `${owner}-private` }],
      digest: { title: owner },
      news: { title: owner },
    }),
  ],
  [
    'scheduled',
    (store) => store.loadScheduledSends(),
    (owner) => ({ scheduledSends: [{ id: `${owner}-private` }] }),
  ],
  [
    'rules',
    (store) => store.loadRules(),
    (owner) => ({ rules: [{ id: owner, name: `${owner}-private` }] }),
  ],
  [
    'contacts',
    (store) => store.loadContacts(),
    (owner) => ({ contacts: [{ address: `${owner}-private@example.com` }] }),
  ],
  [
    'interests',
    (store) => store.loadInterests(),
    (owner) => ({ interests: [`${owner}-private`], personaliseGithub: true }),
  ],
  [
    'notification subscription',
    (store) => store.loadNtfySubscription(),
    (owner) => ({ topic: `${owner}-private`, enabled: true }),
  ],
]

describe('mailbox account isolation', () => {
  it('clears private views, counts, settings and reader state immediately on an owner change', () => {
    const lists = [
      'traditionalEmails',
      'sentEmails',
      'spamEmails',
      'snoozedEmails',
      'starredEmails',
      'labelEmails',
      'doneEmails',
      'processingEmails',
      'screeningEmails',
      'blockedEmails',
      'labels',
      'categories',
      'rules',
      'scheduledSends',
      'contacts',
      'tasks',
      'interests',
      'chatHistory',
      'toasts',
    ]
    const flags = [
      'isInboxLoaded',
      'isInboxStateLoaded',
      'isSentLoaded',
      'isSpamLoaded',
      'isSnoozedLoaded',
      'isStarredLoaded',
      'isLabelLoaded',
      'isDoneLoaded',
      'isLabelsLoaded',
      'isCategoriesLoaded',
      'isScheduledSendsLoaded',
      'contactsLoaded',
      'tasksLoaded',
      'interestsLoaded',
    ]
    for (const field of lists) store[field] = [{ id: 'alice-private' }]
    for (const field of flags) store[field] = true
    store.userId = 'alice-private'
    store.ntfySubscription = { topic: 'alice-private' }
    store.unreadInboxCount = store.spamCount = store.scheduledCountHint = 9
    store.openEmailId = 'alice-private'
    store.messageBodies.set('alice-private', { html: '<p>Alice private message</p>' })
    store.threadSummaries.set('alice-private', 'Alice private summary')
    store.digest = store.news = { text: 'alice-private' }
    store.isChatDrawerActive = true
    store.isAiDraftActive = true
    store.aiDraftPreview = 'alice-private'

    switchOwner('bob')

    for (const field of lists) expect({ [field]: store[field] }).toEqual({ [field]: [] })
    for (const field of flags) expect({ [field]: store[field] }).toEqual({ [field]: false })
    expect(store.userId).toBeNull()
    expect(store.ntfySubscription).toBeNull()
    expect(store.unreadInboxCount + store.spamCount + store.scheduledCountHint).toBe(0)
    expect(store.openEmail).toBeNull()
    expect(store.messageBodies.size + store.threadSummaries.size).toBe(0)
    expect(JSON.stringify(store.$state)).not.toContain('alice-private')
  })

  it('preserves the current mailbox and composing session when the owner is unchanged', () => {
    store.traditionalEmails = [{ id: 'alice-private' }]
    store.isComposerActive = true
    store.composerTextArea = 'Current unsaved words'
    const generation = store.composeGeneration
    switchOwner('alice')
    expect(store.traditionalEmails).toEqual([{ id: 'alice-private' }])
    expect(store.composerTextArea).toBe('Current unsaved words')
    expect(store.isComposerActive).toBe(true)
    expect(store.composeGeneration).toBe(generation)
  })

  describe.each(['fetch', 'json'])('switching while %s is pending', (stage) => {
    it.each(loaders)(
      'does not let the previous %s load overwrite the new mailbox',
      async (_, load, payload) => {
        const pending = deferred()
        const json = vi.fn(() => pending.promise)
        const fetchMock = vi.fn()
        if (stage === 'fetch') fetchMock.mockReturnValueOnce(pending.promise)
        else fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json })
        fetchMock.mockResolvedValueOnce(ok(payload('bob')))
        vi.stubGlobal('fetch', fetchMock)
        const oldLoad = load(store)
        await vi.waitFor(() => expect(stage === 'fetch' ? fetchMock : json).toHaveBeenCalledOnce())

        switchOwner('bob')
        await load(store)
        const bobState = JSON.stringify(store.$state)
        expect(bobState).toContain('bob-private')
        pending.resolve(stage === 'fetch' ? ok(payload('alice')) : payload('alice'))
        await oldLoad

        expect(JSON.stringify(store.$state)).toBe(bobState)
        expect(store.notify).not.toHaveBeenCalled()
      },
    )
  })

  it.each(loaders)(
    'does not dispatch the previous %s load after credentials change',
    async (_, load) => {
      const authorization = deferred()
      store.authHeaders.mockReturnValueOnce(authorization.promise)
      vi.stubGlobal('fetch', vi.fn())
      const loading = load(store)
      await vi.waitFor(() => expect(store.authHeaders).toHaveBeenCalledOnce())
      switchOwner('bob')
      authorization.resolve({ Authorization: 'Bearer bob-test-token' })
      await loading
      expect(fetch).not.toHaveBeenCalled()
      expect(store.notify).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['inbox', (store) => store.loadEmails(), page('alice')],
    ['inbox state', (store) => store.loadInboxState(), page('alice')],
    ['spam', (store) => store.loadSpamEmails(), page('alice')],
    ['done', (store) => store.loadDonePage(), page('alice')],
    ['labels', (store) => store.loadLabels(), [{ name: 'alice-private' }]],
    ['categories', (store) => store.loadCategories(), [{ name: 'alice-private' }]],
  ])(
    'does not apply a previous account’s %s cache after a delayed IndexedDB read',
    async (_, load, payload) => {
      const cached = deferred()
      const read = vi.spyOn(db, 'get').mockReturnValueOnce(cached.promise)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
      const loading = load(store)
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
      switchOwner('bob')
      const bobState = JSON.stringify(store.$state)
      cached.resolve({ value: payload })
      await loading
      expect(JSON.stringify(store.$state)).toBe(bobState)
      expect(store.notify).not.toHaveBeenCalled()
    },
  )

  it('does not restore a previous account’s message when its optimistic snooze fails', async () => {
    const pending = deferred()
    vi.spyOn(store, 'updateMessage').mockReturnValueOnce(pending.promise)
    const message = { id: 'alice-private', unread: true }
    store.traditionalEmails = [message]
    store.isInboxLoaded = true
    const scheduling = store.scheduleEmail(message, '2030-01-01T09:00:00Z', 'later')
    switchOwner('bob')
    store.traditionalEmails = [{ id: 'bob-private' }]
    store.notify.mockClear()
    pending.reject(new Error('Old account request failed'))
    expect(await scheduling).toBe(false)
    expect(store.traditionalEmails).toEqual([{ id: 'bob-private' }])
    expect(store.notify).not.toHaveBeenCalled()
  })
})
