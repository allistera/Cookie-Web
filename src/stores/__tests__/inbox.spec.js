import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'
import { mergeInboxPage, useInboxStore, mapEmailRow } from '../inbox'
import { setAuth0Client } from '../../auth0-client'
import { localToday } from '../../lib/localDate'
import {
  AI_API_URL,
  EMAILS_API_URL,
  SEARCH_API_URL,
  LABELS_API_URL,
  MESSAGES_API_URL,
  RECEIPTS_API_URL,
  TASKS_API_URL,
} from '../../lib/apiWorkers'

describe('Inbox Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAuth0Client({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('Draft autosave', () => {
    const DRAFT_ID = 'draft-1'

    function armComposer(store) {
      store.isComposerActive = true
      store.composerTo = 'someone@example.com'
      store.composerSubject = 'Hello'
      store.composerTextArea = 'Checking in.'
    }

    function stubDraftFetch({ status = 201, id = DRAFT_ID } = {}) {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: status < 400,
        status,
        json: async () => ({ draft: { id, updatedAt: '2026-09-03T10:00:00Z' } }),
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('creates the row on the first save and updates the same one after', async () => {
      const fetchMock = stubDraftFetch()
      const store = useInboxStore()
      armComposer(store)

      await store.saveComposerDraft()
      expect(fetchMock.mock.calls[0][1].method).toBe('POST')
      expect(store.composerDraftId).toBe(DRAFT_ID)

      await store.saveComposerDraft()
      const [url, options] = fetchMock.mock.calls[1]
      expect(options.method).toBe('PATCH')
      expect(url).toContain(`/drafts/${DRAFT_ID}`)
    })

    it('sends attachment ids rather than attachment objects', async () => {
      const fetchMock = stubDraftFetch()
      const store = useInboxStore()
      armComposer(store)
      store.composerAttachments = [{ id: 'att-1', filename: 'plan.pdf', source: 'upload' }]

      await store.saveComposerDraft()

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).attachmentIds).toEqual(['att-1'])
    })

    it('starts a fresh row when the draft was deleted elsewhere', async () => {
      // Another tab (or the Drafts view) removed it; resurrecting a dead id
      // would silently drop everything typed since.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ draft: { id: 'draft-2' } }),
        })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)
      store.composerDraftId = DRAFT_ID

      await store.saveComposerDraft()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1][1].method).toBe('POST')
      expect(store.composerDraftId).toBe('draft-2')
    })

    it('keeps the draft through the undo window and deletes it only once sent', async () => {
      vi.useFakeTimers()
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg-1' }) })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)
      store.composerDraftId = DRAFT_ID

      store.sendEmail()
      // Still recoverable: nothing has gone out yet.
      expect(fetchMock).not.toHaveBeenCalled()
      expect(store.pendingSend.draftId).toBe(DRAFT_ID)

      store.undoPendingSend()
      expect(store.composerDraftId).toBe(DRAFT_ID)
      expect(fetchMock).not.toHaveBeenCalled()

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)
      const deleted = fetchMock.mock.calls.find(([, options]) => options?.method === 'DELETE')
      expect(deleted[0]).toContain(`/drafts/${DRAFT_ID}`)
      vi.useRealTimers()
    })

    it('keeps the draft when the send fails', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)
      store.composerDraftId = DRAFT_ID

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)

      expect(store.composerDraftId).toBe(DRAFT_ID)
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
      vi.useRealTimers()
    })

    it('does not attach a slow upload to the next message the user starts', async () => {
      // Devin review: closing one message and starting another during an
      // upload let the old file land on the new message.
      const store = useInboxStore()
      store.isComposerActive = true
      store.userId = 'user-1'
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(store, 'uploadAttachmentFiles').mockImplementation(async () => {
        // The composer is closed and reopened while the upload is in flight.
        store.closeComposer({ save: false })
        store.openComposer()
        return [{ id: 'att-late', filename: 'slow.pdf', source: 'upload' }]
      })

      await store.attachComposerFiles([{ name: 'slow.pdf', size: 10 }])

      expect(store.composerAttachments).toEqual([])
      // Orphaned bytes are reclaimed rather than left for the sweep. The
      // discard is deliberately not awaited by the caller, so wait for it.
      await vi.waitFor(() => {
        const deleted = fetchMock.mock.calls.find(([, options]) => options?.method === 'DELETE')
        expect(deleted?.[0]).toContain('att-late')
      })
    })

    it('does not let a save that was in flight claim a later session', async () => {
      const store = useInboxStore()
      armComposer(store)
      vi.spyOn(store, 'persistDraft').mockImplementation(async () => {
        // A send takes the draft while this save is still in flight.
        store.consumeComposerDraft()
        return 'draft-from-old-session'
      })

      await store.saveComposerDraft()

      expect(store.composerDraftId).toBeNull()
    })

    it('serializes overlapping saves so one composer cannot create two rows', async () => {
      const store = useInboxStore()
      armComposer(store)
      let creates = 0
      vi.spyOn(store, 'persistDraft').mockImplementation(async (draftId) => {
        if (!draftId) creates += 1
        return DRAFT_ID
      })

      // The debounce firing and a flush-on-close, overlapping.
      await Promise.all([store.saveComposerDraft(), store.saveComposerDraft()])

      expect(creates).toBe(1)
      expect(store.composerDraftId).toBe(DRAFT_ID)
    })

    it('flushes the draft it is replacing before opening another', async () => {
      const store = useInboxStore()
      armComposer(store)
      store.composerDraftId = DRAFT_ID
      const saved = []
      vi.spyOn(store, 'persistDraft').mockImplementation(async (draftId, draft) => {
        saved.push({ draftId, text: draft.text })
        return draftId ?? 'draft-2'
      })

      await store.openDraft({ id: 'draft-2', to: 'x@y.com', subject: 'Other', text: 'Other body' })

      // The outgoing draft's last edits reached the server, against its own row.
      expect(saved).toEqual([{ draftId: DRAFT_ID, text: 'Checking in.' }])
      expect(store.composerDraftId).toBe('draft-2')
      expect(store.composerTextArea).toBe('Other body')
    })

    it('reopens a saved draft into the composer and keeps writing to that row', () => {
      const store = useInboxStore()

      store.openDraft({
        id: DRAFT_ID,
        to: 'a@b.com',
        subject: 'Half written',
        text: 'Body',
        html: '<p>Body</p>',
        attachments: [{ id: 'att-1', filename: 'plan.pdf' }],
      })

      expect(store.isComposerActive).toBe(true)
      expect(store.composerTo).toBe('a@b.com')
      expect(store.composerAttachments).toHaveLength(1)
      expect(store.composerDraftId).toBe(DRAFT_ID)
    })

    it('lists a draft as soon as its first save lands, so the sidebar folder can appear', async () => {
      stubDraftFetch()
      const store = useInboxStore()
      expect(store.draftCount).toBe(0)
      armComposer(store)

      await store.saveComposerDraft()
      expect(store.draftCount).toBe(1)
      expect(store.drafts[0]).toMatchObject({
        id: DRAFT_ID,
        to: 'someone@example.com',
        subject: 'Hello',
        text: 'Checking in.',
        updatedAt: '2026-09-03T10:00:00Z',
      })

      // Later saves rewrite the same entry rather than adding another.
      store.composerSubject = 'Hello again'
      await store.saveComposerDraft()
      expect(store.draftCount).toBe(1)
      expect(store.drafts[0].subject).toBe('Hello again')
    })

    it('drops a draft from the list once a save empties it', async () => {
      // The worker answers an emptying PATCH with 204: the row is gone.
      stubDraftFetch({ status: 204 })
      const store = useInboxStore()
      store.drafts = [{ id: DRAFT_ID, subject: 'Hello' }]
      store.isComposerActive = true
      store.composerDraftId = DRAFT_ID

      await store.saveComposerDraft()

      expect(store.composerDraftId).toBeNull()
      expect(store.draftCount).toBe(0)
    })

    it('forgets a draft that was deleted elsewhere before starting its fresh row', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ draft: { id: 'draft-2', updatedAt: '2026-09-03T10:01:00Z' } }),
        })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      store.drafts = [{ id: DRAFT_ID, subject: 'Hello' }]
      armComposer(store)
      store.composerDraftId = DRAFT_ID

      await store.saveComposerDraft()

      expect(store.drafts.map((draft) => draft.id)).toEqual(['draft-2'])
    })

    it('discarding a draft removes it from the list', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }))
      const store = useInboxStore()
      store.drafts = [{ id: DRAFT_ID }, { id: 'draft-2' }]

      await store.discardDraft(DRAFT_ID)

      expect(store.drafts.map((draft) => draft.id)).toEqual(['draft-2'])
      expect(store.draftCount).toBe(1)
    })

    it('loads drafts quietly for the sidebar and only toasts when asked to', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = useInboxStore()
      const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})

      await store.loadDrafts({ silent: true })
      expect(notify).not.toHaveBeenCalled()

      await store.loadDrafts()
      expect(notify).toHaveBeenCalledWith('Could not load your drafts.', 'error')
    })

    it('replays saves that landed while the drafts list was loading', async () => {
      // Sign-in bootstraps the list while the user has already started
      // typing; the GET's snapshot predates the autosave that followed it.
      let resolveList
      const listResponse = new Promise((resolve) => {
        resolveList = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, options = {}) => {
          if (options.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: async () => ({ draft: { id: DRAFT_ID, updatedAt: '2026-09-03T10:00:00Z' } }),
            }
          }
          await listResponse
          return { ok: true, status: 200, json: async () => ({ drafts: [{ id: 'older' }] }) }
        }),
      )
      const store = useInboxStore()
      const load = store.loadDrafts({ silent: true })
      armComposer(store)
      await store.saveComposerDraft()
      expect(store.draftCount).toBe(1)

      resolveList()
      await load

      expect(store.drafts.map((draft) => draft.id)).toEqual([DRAFT_ID, 'older'])
    })

    it('puts a draft back when deleting it fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = useInboxStore()
      const notify = vi.spyOn(store, 'notify').mockImplementation(() => {})
      store.drafts = [{ id: 'first' }, { id: DRAFT_ID }, { id: 'third' }]

      const discard = store.discardDraft(DRAFT_ID)
      expect(store.draftCount).toBe(2)
      await discard

      expect(store.drafts.map((draft) => draft.id)).toEqual(['first', DRAFT_ID, 'third'])
      expect(notify).toHaveBeenCalledWith('Could not delete the draft.', 'error')
    })

    it('hands a row created after the send began to that send', async () => {
      vi.useFakeTimers()
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg-1' }) })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)
      let finishSave
      const saved = new Promise((resolve) => {
        finishSave = () => resolve(DRAFT_ID)
      })
      vi.spyOn(store, 'persistDraft').mockImplementation(() => saved)
      const save = store.saveComposerDraft()

      // Send clicked while that first POST is still in flight: no id yet.
      const send = store.sendEmail()
      expect(store.pendingSend.draftId).toBeNull()

      finishSave()
      await save
      await send
      expect(store.pendingSend.draftId).toBe(DRAFT_ID)
      expect(store.composerDraftId).toBeNull()

      await vi.advanceTimersByTimeAsync(5000)
      const deleted = fetchMock.mock.calls.find(([, options]) => options?.method === 'DELETE')
      expect(deleted[0]).toContain(`/drafts/${DRAFT_ID}`)
      vi.useRealTimers()
    })

    it('returns a late row to the composer when the send is undone first', async () => {
      const store = useInboxStore()
      armComposer(store)
      let finishSave
      const saved = new Promise((resolve) => {
        finishSave = () => resolve(DRAFT_ID)
      })
      vi.spyOn(store, 'persistDraft').mockImplementation(() => saved)
      const save = store.saveComposerDraft()
      const send = store.sendEmail()
      store.undoPendingSend()
      expect(store.composerDraftId).toBeNull()

      finishSave()
      await save
      await send

      expect(store.isComposerActive).toBe(true)
      expect(store.composerDraftId).toBe(DRAFT_ID)
    })

    it('waits for an in-flight first save before scheduling a send', async () => {
      const calls = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, options = {}) => {
          calls.push([url, options.method ?? 'GET'])
          return {
            ok: true,
            status: 200,
            json: async () => ({ scheduledSend: { id: 'sched-1' } }),
          }
        }),
      )
      const store = useInboxStore()
      vi.spyOn(store, 'notify').mockImplementation(() => {})
      armComposer(store)
      let finishSave
      const saved = new Promise((resolve) => {
        finishSave = () => resolve(DRAFT_ID)
      })
      vi.spyOn(store, 'persistDraft').mockImplementation(() => saved)
      const save = store.saveComposerDraft()
      const later = store.sendEmailLater('2026-09-04T09:00:00Z', 'tomorrow')
      await Promise.resolve()
      expect(calls).toEqual([])

      finishSave()
      await save
      await later

      expect(calls.map(([, method]) => method)).toEqual(['POST', 'DELETE'])
      expect(calls[1][0]).toContain(`/drafts/${DRAFT_ID}`)
    })

    it('does not autosave a composer that has already closed', async () => {
      const fetchMock = stubDraftFetch()
      const store = useInboxStore()
      armComposer(store)
      store.isComposerActive = false

      await store.saveComposerDraft()

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('loads emails from the API and maps them for the inbox list', async () => {
    const sentAt = new Date()
    sentAt.setHours(10, 4, 0, 0)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'abc-123',
              from_name: 'City Construction',
              from_address: 'updates@cityconstruction.com',
              subject: 'Revised Floor Plan',
              snippet: 'Hi Allister, following up...',
              sent_at: sentAt.toISOString(),
              is_unread: true,
              is_starred: false,
              has_ai_summary: true,
              follow_up_at: '2026-08-20T09:00:00.000Z',
            },
          ],
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadEmails()

    expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails?limit=50`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.traditionalEmails).toEqual([
      {
        id: 'abc-123',
        sender: 'City Construction',
        address: 'updates@cityconstruction.com',
        isSent: false,
        isSpam: false,
        isPriority: false,
        isArchived: false,
        to: null,
        recipients: { to: [], cc: [] },
        subject: 'Revised Floor Plan',
        snippet: 'Hi Allister, following up...',
        body: undefined,
        sentAt: sentAt.toISOString(),
        date: '10:04 am',
        unread: true,
        starred: false,
        scheduledFor: null,
        followUpAt: '2026-08-20T09:00:00.000Z',
        readAt: null,
        readCount: 0,
        hasHtml: false,
        hasAiSummary: true,
        hasAttachments: false,
        labels: [],
      },
    ])
    expect(store.unreadInboxCount).toBe(1)
    expect(store.isInboxLoaded).toBe(true)
    expect(store.isRefreshing).toBe(false)
  })

  it('loads lightweight inbox state without populating the mailbox list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unreadCount: 9, userId: 'user-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()

    await store.loadInboxState()
    await store.loadInboxState()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails/state`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.unreadInboxCount).toBe(9)
    expect(store.userId).toBe('user-1')
    expect(store.traditionalEmails).toEqual([])
    expect(store.isInboxStateLoaded).toBe(true)
    expect(store.isInboxLoaded).toBe(false)
  })

  it('uses the server unread count and cursor when provided', async () => {
    const row = (id) => ({
      id,
      from_name: 'Sender',
      from_address: 's@example.com',
      subject: `Subject ${id}`,
      snippet: '',
      body_text: '',
      sent_at: new Date().toISOString(),
      is_unread: false,
      is_starred: false,
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            emails: [row('a')],
            nextCursor: '2026-07-01T00:00:00Z|11111111-1111-1111-1111-111111111111',
            unreadCount: 42,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ emails: [row('b')], nextCursor: null, unreadCount: 42 }),
        }),
    )

    const store = useInboxStore()
    await store.loadEmails()
    expect(store.unreadInboxCount).toBe(42)
    expect(store.hasMoreEmails).toBe(true)

    await store.loadMoreEmails()
    expect(fetch).toHaveBeenLastCalledWith(
      `${EMAILS_API_URL}/emails?limit=50&before=2026-07-01T00%3A00%3A00Z%7C11111111-1111-1111-1111-111111111111`,
      { headers: { Authorization: 'Bearer test-access-token' } },
    )
    expect(store.traditionalEmails.map((e) => e.id)).toEqual(['a', 'b'])
    expect(store.hasMoreEmails).toBe(false)

    // No cursor left: loadMoreEmails is a no-op.
    await store.loadMoreEmails()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('mergeInboxPage reuses existing row objects and keeps extra pages', () => {
    const existingA = { id: 'a', starred: true, unread: false, subject: 'old a' }
    const existingB = { id: 'b', starred: false, unread: true, subject: 'old b' }
    const incoming = [
      { id: 'z', starred: false, unread: true, subject: 'new z' },
      { id: 'a', starred: false, unread: true, subject: 'new a' },
    ]
    const pendingStarIds = new Set(['a'])
    const pendingUnreadIds = new Set(['a'])

    const merged = mergeInboxPage(
      [existingA, existingB],
      incoming,
      pendingStarIds,
      pendingUnreadIds,
    )

    expect(merged.map((email) => email.id)).toEqual(['z', 'a', 'b'])
    expect(merged[1]).toBe(existingA)
    expect(existingA.subject).toBe('new a')
    expect(existingA.starred).toBe(true)
    expect(existingA.unread).toBe(false)
    expect(merged[2]).toBe(existingB)
  })

  it('refreshInbox merges the first page without dropping extra rows or in-flight stars', async () => {
    const listRow = (id, extra = {}) => ({
      id,
      from_name: 'Sender',
      from_address: 's@example.com',
      subject: `Subject ${id}`,
      snippet: '',
      body_text: '',
      sent_at: new Date().toISOString(),
      is_unread: true,
      is_starred: false,
      ...extra,
    })
    let resolveStar
    const fetchMock = vi.fn((url, options = {}) => {
      if (options.method === 'PATCH') {
        return new Promise((resolve) => {
          resolveStar = resolve
        })
      }
      return {
        ok: true,
        json: async () => ({
          emails: [listRow('z'), listRow('a', { is_starred: false, is_unread: true })],
          nextCursor: 'cursor-new',
          unreadCount: 4,
          userId: 'user-1',
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    const originalA = {
      id: 'a',
      sender: 'Sender',
      subject: 'Subject a',
      starred: false,
      unread: true,
      labels: [],
    }
    const extraB = {
      id: 'b',
      sender: 'Sender',
      subject: 'Subject b',
      starred: false,
      unread: true,
      labels: [],
    }
    const extraC = {
      id: 'c',
      sender: 'Sender',
      subject: 'Subject c',
      starred: false,
      unread: true,
      labels: [],
    }
    store.traditionalEmails = [originalA, extraB, extraC]
    const storedA = store.traditionalEmails[0]
    store.isInboxLoaded = true
    store.emailsCursor = 'cursor-old'
    store.hasMoreEmails = true

    store.toggleStar(storedA)
    expect(storedA.starred).toBe(true)

    await store.refreshInbox()

    expect(
      fetchMock.mock.calls.some(([_url, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true)
    expect(store.traditionalEmails.map((email) => email.id)).toEqual(['z', 'a', 'b', 'c'])
    expect(store.traditionalEmails.find((email) => email.id === 'a')).toBe(storedA)
    expect(storedA.starred).toBe(true)
    expect(store.emailsCursor).toBe('cursor-old')
    expect(store.hasMoreEmails).toBe(true)
    expect(store.unreadInboxCount).toBe(4)
    expect(store.userId).toBe('user-1')

    resolveStar({ ok: true, json: async () => ({ message: {} }) })
    await vi.waitFor(() => expect(storedA.starred).toBe(true))
  })

  it('refreshInbox is a no-op while search results are showing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.isInboxLoaded = true
    store.activeSearchQuery = 'renovation'

    await store.refreshInbox()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads sent emails into the outbox list with recipient display fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'sent-1',
              from_name: 'Allister',
              from_address: 'me@allisterantosik.com',
              recipients: {
                to: [{ name: null, address: 'info@citytileandstone.com' }],
                cc: [{ name: 'Site Lead', address: 'lead@citytileandstone.com' }],
                bcc: [{ name: null, address: 'hidden@example.com' }],
              },
              subject: 'Re: Kitchen Renovation - Tile Selection Due',
              snippet: 'I confirm the selection of the White Subway Tiles...',
              body_text: 'I confirm the selection of the White Subway Tiles.',
              sent_at: new Date().toISOString(),
              is_unread: false,
              is_starred: false,
              is_sent: true,
            },
          ],
          nextCursor: null,
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadSentEmails()

    expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails?folder=sent&limit=50`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.sentEmails).toHaveLength(1)
    expect(store.sentEmails[0].to).toBe('info@citytileandstone.com')
    // The reader's reply-all needs the full To/Cc lists; Bcc stays private.
    expect(store.sentEmails[0].recipients).toEqual({
      to: [{ name: null, address: 'info@citytileandstone.com' }],
      cc: [{ name: 'Site Lead', address: 'lead@citytileandstone.com' }],
    })
    expect(store.sentEmails[0].isSent).toBe(true)
    expect(store.hasMoreSent).toBe(false)
    expect(store.isSentLoaded).toBe(true)
  })

  it('pages the sent list with the keyset cursor', async () => {
    const row = (id) => ({
      id,
      from_name: 'Allister',
      from_address: 'me@allisterantosik.com',
      recipients: { to: [{ name: null, address: 'x@example.com' }], cc: [], bcc: [] },
      subject: `Sent ${id}`,
      snippet: '',
      body_text: '',
      sent_at: new Date().toISOString(),
      is_unread: false,
      is_starred: false,
      is_sent: true,
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            emails: [row('a')],
            nextCursor: '2026-07-01T00:00:00Z|11111111-1111-1111-1111-111111111111',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ emails: [row('b')], nextCursor: null }),
        }),
    )

    const store = useInboxStore()
    await store.loadSentEmails()
    expect(store.hasMoreSent).toBe(true)

    await store.loadMoreSentEmails()
    expect(fetch).toHaveBeenLastCalledWith(
      `${EMAILS_API_URL}/emails?folder=sent&limit=50&before=2026-07-01T00%3A00%3A00Z%7C11111111-1111-1111-1111-111111111111`,
      { headers: { Authorization: 'Bearer test-access-token' } },
    )
    expect(store.sentEmails.map((e) => e.id)).toEqual(['a', 'b'])
    expect(store.hasMoreSent).toBe(false)

    // No cursor left: loadMoreSentEmails is a no-op.
    await store.loadMoreSentEmails()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('hydrates best-effort read status after loading sent mail', async () => {
    const openedAt = '2026-07-24T10:30:00.000Z'
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      from_name: 'Allister',
      from_address: 'me@example.com',
      recipients: { to: [{ name: null, address: 'reader@example.com' }] },
      subject: 'Status update',
      snippet: 'Hello',
      body_text: 'Hello',
      sent_at: '2026-07-24T10:00:00.000Z',
      is_unread: false,
      is_starred: false,
      is_sent: true,
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            emails: [row],
            nextCursor: null,
            readReceiptsAvailable: true,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            receipts: [{ message_id: row.id, first_opened_at: openedAt, open_count: 2 }],
          }),
        }),
    )

    const store = useInboxStore()
    await store.loadSentEmails()

    expect(fetch).toHaveBeenLastCalledWith(
      `${RECEIPTS_API_URL}/read-receipts?messageIds=${row.id}`,
      {
        headers: { Authorization: 'Bearer test-access-token' },
      },
    )
    expect(store.sentEmails[0]).toMatchObject({ readAt: openedAt, readCount: 2 })
  })

  it('loads spam from its isolated server-backed folder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'spam-1',
              from_name: 'Spammer',
              from_address: 'spam@example.com',
              subject: 'Guaranteed prize',
              snippet: 'Act now',
              body_text: 'Act now',
              sent_at: new Date().toISOString(),
              is_unread: true,
              is_starred: false,
            },
          ],
          nextCursor: null,
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadSpamEmails()

    expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails?folder=spam&limit=50`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.spamEmails.map((email) => email.id)).toEqual(['spam-1'])
  })

  it('loads starred emails as a server-backed folder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'star-1',
              from_name: 'Sender',
              from_address: 's@example.com',
              subject: 'Starred',
              snippet: '',
              body_text: '',
              sent_at: new Date().toISOString(),
              is_unread: false,
              is_starred: true,
            },
          ],
          nextCursor: null,
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadStarredEmails()

    expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails?folder=starred&limit=50`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.starredEmails.map((email) => email.id)).toEqual(['star-1'])
    expect(store.isStarredLoaded).toBe(true)
  })

  it('loads a named label folder with the label query param', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'lab-1',
              from_name: 'Sender',
              from_address: 's@example.com',
              subject: 'Home',
              snippet: '',
              body_text: '',
              sent_at: new Date().toISOString(),
              is_unread: false,
              is_starred: false,
              labels: [{ name: 'Home', color: '#ff0000' }],
            },
          ],
          nextCursor: null,
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadLabelEmails('Home')

    expect(fetch).toHaveBeenCalledWith(
      `${EMAILS_API_URL}/emails?folder=label&label=Home&limit=50`,
      {
        headers: { Authorization: 'Bearer test-access-token' },
      },
    )
    expect(store.labelEmails.map((email) => email.id)).toEqual(['lab-1'])
    expect(store.labelFolderName).toBe('Home')
    expect(store.isLabelLoaded).toBe(true)
  })

  describe('Done pager', () => {
    // Local-noon timestamps keep calendar-day math timezone-independent.
    const doneRow = (id, daysAgo) => ({
      id,
      from_name: 'Finished Sender',
      from_address: 'finished@example.com',
      subject: `Done ${id}`,
      snippet: '',
      body_text: '',
      sent_at: new Date(2026, 6, 10 - daysAgo, 12, 0, 0).toISOString(),
      is_unread: false,
      is_starred: false,
      is_sent: false,
    })
    const pageResponse = (emails, nextCursor) => ({
      ok: true,
      json: async () => ({ emails, nextCursor }),
    })

    it('loads the last page whole when no further page exists', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(pageResponse([doneRow('done-a', 0), doneRow('done-b', 1)], null)),
      )
      const store = useInboxStore()
      await store.loadDonePage()

      expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails?folder=done&limit=100`, {
        headers: { Authorization: 'Bearer test-access-token' },
      })
      expect(store.doneEmails.map((email) => email.id)).toEqual(['done-a', 'done-b'])
      expect(store.isDoneLoaded).toBe(true)
      expect(store.doneHasNext).toBe(false)
      expect(store.donePageIndex).toBe(0)
    })

    it('holds back the trailing day when more pages exist, and pages Older/Newer', async () => {
      // Page 1: two emails on day 0, one on day 1 — day 1 may continue on the
      // server's next page, so it moves to page 2 wholesale.
      const first = [doneRow('a1', 0), doneRow('a2', 0), doneRow('b1', 1)]
      const second = [doneRow('b1', 1), doneRow('b2', 1)]
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(pageResponse(first, 'server-cursor|ignored'))
          .mockResolvedValueOnce(pageResponse(second, null))
          .mockResolvedValueOnce(pageResponse(first, 'server-cursor|ignored')),
      )
      const store = useInboxStore()
      await store.loadDonePage()

      expect(store.doneEmails.map((email) => email.id)).toEqual(['a1', 'a2'])
      expect(store.doneHasNext).toBe(true)

      await store.nextDonePage()
      // The next page starts where the trimmed page ended: after a2.
      const expectedCursor = encodeURIComponent(`${first[1].sent_at}|a2`)
      expect(fetch).toHaveBeenLastCalledWith(
        `${EMAILS_API_URL}/emails?folder=done&limit=100&before=${expectedCursor}`,
        { headers: { Authorization: 'Bearer test-access-token' } },
      )
      expect(store.donePageIndex).toBe(1)
      expect(store.doneEmails.map((email) => email.id)).toEqual(['b1', 'b2'])
      expect(store.doneHasNext).toBe(false)

      await store.prevDonePage()
      expect(fetch).toHaveBeenLastCalledWith(`${EMAILS_API_URL}/emails?folder=done&limit=100`, {
        headers: { Authorization: 'Bearer test-access-token' },
      })
      expect(store.donePageIndex).toBe(0)
      expect(store.doneEmails.map((email) => email.id)).toEqual(['a1', 'a2'])
    })

    it('shows a single oversized day untrimmed rather than an empty page', async () => {
      const sameDay = [doneRow('c1', 0), doneRow('c2', 0), doneRow('c3', 0)]
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(pageResponse(sameDay, 'server-cursor|ignored')),
      )
      const store = useInboxStore()
      await store.loadDonePage()

      expect(store.doneEmails.map((email) => email.id)).toEqual(['c1', 'c2', 'c3'])
      expect(store.doneHasNext).toBe(true)
    })
  })

  it('generates a reviewable AI draft without sending it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ draft: { subject: 'Hello 😊', text: 'Generated body 🎉' } }),
      }),
    )
    const store = useInboxStore()
    store.composerTo = 'person@example.com'
    store.composerAiInstruction = 'Confirm Tuesday works.'

    await store.requestAiDraft()

    expect(fetch).toHaveBeenCalledWith(`${AI_API_URL}/compose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({
        instruction: 'Confirm Tuesday works.',
        to: 'person@example.com',
        subject: '',
        existingText: '',
      }),
    })
    expect(store.aiDraftPreview).toBe('Generated body \\o/')
    expect(store.composerSubject).toBe('Hello :)')
    expect(store.composerTextArea).toBe('')

    store.insertAiDraft()
    expect(store.composerTextArea).toBe('Generated body \\o/')
  })

  it('excludes the personal signature from the AI compose request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ draft: { subject: '', text: 'Generated body' } }),
      }),
    )
    const store = useInboxStore()
    store.signatureHtml = '<p>Best, <strong>Allister</strong></p>'
    store.composerTo = 'person@example.com'
    // A fresh draft prefills blank lines above the signature; the user has typed
    // one line of their own on top.
    store.composerTextArea = 'Thanks for the update.\n\n\nBest, Allister'
    store.composerAiInstruction = 'Confirm Tuesday works.'

    await store.requestAiDraft()

    expect(fetch).toHaveBeenCalledWith(`${AI_API_URL}/compose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({
        instruction: 'Confirm Tuesday works.',
        to: 'person@example.com',
        subject: '',
        existingText: 'Thanks for the update.',
      }),
    })
  })

  it('turns an email task into an editable, threaded follow-up draft', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contacts: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draft: { subject: 'Ignored', text: 'Tuesday works for me.' } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.signatureHtml = '<p>Best, <strong>Allister</strong></p>'

    await expect(
      store.draftFollowUp({
        id: 'task-1',
        content: 'Confirm delivery',
        description: 'Ask whether Tuesday still works.',
        message_id: '11111111-1111-1111-1111-111111111111',
        reply_to: 'contractor@example.com',
        message_subject: 'Delivery date',
      }),
    ).resolves.toBe(true)

    expect(store.isComposerActive).toBe(true)
    expect(store.composerTo).toBe('contractor@example.com')
    expect(store.composerSubject).toBe('Re: Delivery date')
    expect(store.composerReplyToMessageId).toBe('11111111-1111-1111-1111-111111111111')
    expect(store.composerTextArea).toContain('Tuesday works for me.')
    expect(store.composerTextArea).toContain('Best, Allister')
    expect(store.isAiDraftActive).toBe(false)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      to: 'contractor@example.com',
      subject: 'Re: Delivery date',
      replyToMessageId: '11111111-1111-1111-1111-111111111111',
    })
  })

  it('toggleMessageLabel POSTs the right action and syncs the email labels', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ labels: [{ name: 'Work', color: '#3b82f6', kind: 'user' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    const email = { id: 'msg-1', labels: [] }
    const label = { id: 'lbl-1', name: 'Work', color: '#3b82f6' }

    // Not yet applied → add_label.
    await store.toggleMessageLabel(email, label)
    expect(fetchMock).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'msg-1', action: 'add_label', label_id: 'lbl-1' }),
    })
    expect(email.labels).toEqual([{ name: 'Work', color: '#3b82f6', kind: 'user' }])

    // Now applied → the next toggle removes it.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ labels: [] }) })
    await store.toggleMessageLabel(email, label)
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${MESSAGES_API_URL}/messages`,
      expect.objectContaining({
        body: JSON.stringify({ id: 'msg-1', action: 'remove_label', label_id: 'lbl-1' }),
      }),
    )
    expect(email.labels).toEqual([])
  })

  it('summarizes an email thread and caches the result for the open message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ summary: 'The contractor confirmed the Tuesday delivery.' }),
      }),
    )
    const store = useInboxStore()
    const email = { id: '11111111-1111-1111-1111-111111111111', unread: false }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    await store.summarizeEmail(email)

    expect(fetch).toHaveBeenCalledWith(`${AI_API_URL}/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: email.id }),
    })
    expect(store.openEmailSummary).toBe('The contractor confirmed the Tuesday delivery.')
    expect(store.isOpenSummaryLoading).toBe(false)
  })

  it('refreshes the sent list after sending mail once it has been loaded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ emails: [], nextCursor: null }) })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    await store.loadSentEmails()
    fetchMock.mockClear()
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'msg-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ emails: [], nextCursor: null }),
      })

    await store.sendMail({ to: 'someone@example.com', subject: 'S', text: 'T' })
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${EMAILS_API_URL}/emails?folder=sent&limit=50`,
        expect.anything(),
      ),
    )
  })

  it('loadContacts fetches once and populates contacts for auto-suggest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contacts: [{ address: 'ann@example.com', name: 'Ann' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()

    await store.loadContacts()
    expect(store.contacts).toEqual([{ address: 'ann@example.com', name: 'Ann' }])
    expect(store.contactsLoaded).toBe(true)

    await store.loadContacts() // already loaded: no second request
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${MESSAGES_API_URL}/messages/contacts`)
  })

  it('setSignature persists the signature and openComposer prefills a fresh draft with it', () => {
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }),
    )
    const store = useInboxStore()

    store.setSignature('<p>Best, <strong>Allister</strong></p>')
    expect(store.signatureHtml).toBe('<p>Best, <strong>Allister</strong></p>')
    expect(localStorage.getItem('cookie-signature-html')).toBe(
      '<p>Best, <strong>Allister</strong></p>',
    )

    store.openComposer()
    expect(store.composerHtml).toContain('<p>Best, <strong>Allister</strong></p>')
    expect(store.composerTextArea).toContain('Best, Allister')
  })

  it('openComposer does not overwrite an in-progress draft with the signature', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }),
    )
    const store = useInboxStore()
    store.signatureHtml = '<p>Sig</p>'
    store.composerHtml = '<p>existing draft</p>'

    store.openComposer()
    expect(store.composerHtml).toBe('<p>existing draft</p>')
  })

  it('openComposer loads contacts for auto-suggest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contacts: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()

    store.openComposer()
    expect(store.isComposerActive).toBe(true)
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${MESSAGES_API_URL}/messages/contacts`,
        expect.anything(),
      ),
    )
  })

  it('loadTasks fetches once and populates tasks for the AI dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [{ id: 't1', content: 'Ship it' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()

    await store.loadTasks()
    expect(store.tasks).toEqual([{ id: 't1', content: 'Ship it' }])
    expect(store.tasksLoaded).toBe(true)

    await store.loadTasks() // cached: no second request
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${TASKS_API_URL}/tasks?date=${localToday()}`)
  })

  it('completeTask posts the completion and drops the task from the list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.tasks = [
      { id: 't1', source: 'task', content: 'Renew insurance' },
      { id: 't2', source: 'task', content: 'Book dentist' },
    ]

    await store.completeTask('t1')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${TASKS_API_URL}/tasks`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ id: 't1', action: 'complete' })
    expect(store.tasks.map((t) => t.id)).toEqual(['t2'])
  })

  it('completeTask throws and keeps the task when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.tasks = [{ id: 't1', source: 'task', content: 'Renew insurance' }]

    await expect(store.completeTask('t1')).rejects.toThrow('502')
    expect(store.tasks.map((t) => t.id)).toEqual(['t1'])
  })

  it('rescheduleTask posts the new due date and updates the task in place', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.tasks = [{ id: 't1', source: 'task', content: 'Renew insurance', due_date: '2026-08-18' }]

    await store.rescheduleTask('t1', '2026-08-25')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${TASKS_API_URL}/tasks`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      id: 't1',
      action: 'reschedule',
      due_date: '2026-08-25',
    })
    expect(store.tasks[0].due_date).toBe('2026-08-25')
  })

  it('rescheduleTask throws and leaves the due date untouched when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.tasks = [{ id: 't1', source: 'task', content: 'Renew insurance', due_date: '2026-08-18' }]

    await expect(store.rescheduleTask('t1', '2026-08-25')).rejects.toThrow('502')
    expect(store.tasks[0].due_date).toBe('2026-08-18')
  })

  it('allLabels lists every user label from the palette, not just ones on loaded emails', () => {
    const store = useInboxStore()
    store.traditionalEmails = [] // nothing loaded in the inbox list
    store.labels = [
      { id: 'l2', name: 'Work', color: '#0000ff', kind: 'user' },
      { id: 'l1', name: 'Home', color: '#ff0000', kind: 'user' },
      { id: 'l3', name: 'Spam', color: '#999999', kind: 'system' },
    ]

    // Sorted by name, system labels excluded, and present despite no emails.
    expect(store.allLabels.map((l) => l.name)).toEqual(['Home', 'Work'])
  })

  describe('undo send', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function armComposer(store) {
      store.composerTo = 'someone@example.com'
      store.composerSubject = 'Hello'
      store.composerTextArea = 'Checking in.'
    }

    function stubSendOk() {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('queues a countdown instead of sending immediately', () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)

      store.sendEmail()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(store.pendingSend?.secondsLeft).toBe(5)
      expect(store.isComposerActive).toBe(false)
    })

    it('sends once the countdown reaches zero', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe('/api/send')
      expect(store.pendingSend).toBeNull()
      expect(store.toasts.at(-1)?.message).toBe('Email sent.')
    })

    it('sends a comma-separated recipient list through to the API', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      store.composerTo = 'a@b.com, c@d.com'
      store.composerSubject = 'Hi'
      store.composerTextArea = 'Body'

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toBe('a@b.com, c@d.com')
    })

    it('sends the sanitized HTML body alongside the plain text', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      store.composerTo = 'a@b.com'
      store.composerSubject = 'Hi'
      store.composerTextArea = 'Hello there'
      store.composerHtml = '<p>Hello <strong>there</strong></p><script>alert(1)</script>'

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.text).toBe('Hello there')
      expect(body.html).toContain('<strong>there</strong>')
      expect(body.html).not.toContain('<script') // sanitized at the send boundary
    })

    it('converts emoji in the outgoing subject and body while preserving rich HTML', () => {
      stubSendOk()
      const store = useInboxStore()
      store.composerTo = 'a@b.com'
      store.composerSubject = 'Great news 🎉'
      store.composerTextArea = 'Thanks 😊 ❤️'
      store.composerHtml = '<p>Thanks <strong>😊</strong> ❤️</p>'

      store.sendEmail()

      expect(store.pendingSend).toMatchObject({
        subject: 'Great news \\o/',
        text: 'Thanks :) <3',
        html: '<p>Thanks <strong>:)</strong> &lt;3</p>',
      })
    })

    it('preserves follow-up threading through the undo-send queue', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)
      store.composerReplyToMessageId = '11111111-1111-1111-1111-111111111111'

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).replyToMessageId).toBe(
        '11111111-1111-1111-1111-111111111111',
      )
    })

    it('reclaims a removed upload but leaves a forwarded attachment alone', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      store.composerAttachments = [
        { id: 'att-1', filename: 'forwarded.pdf' },
        { id: 'att-2', filename: 'picked.pdf', source: 'upload' },
      ]

      // A forwarded attachment still belongs to the original message, so
      // dropping it from this draft must not delete anything server-side.
      store.removeComposerAttachment('att-1')
      expect(fetchMock).not.toHaveBeenCalled()

      store.removeComposerAttachment('att-2')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain('/api/send?resource=attachment&id=att-2')
      expect(options.method).toBe('DELETE')
      expect(store.composerAttachments).toEqual([])
    })

    it('carries selected forwarded attachment ids through send and undo', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)
      store.composerAttachments = [
        { id: 'att-1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048 },
      ]

      store.sendEmail()
      expect(store.composerAttachments).toEqual([])
      expect(store.pendingSend.attachments).toEqual([
        expect.objectContaining({ id: 'att-1', filename: 'plan.pdf' }),
      ])

      store.undoPendingSend()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(store.composerAttachments).toEqual([
        expect.objectContaining({ id: 'att-1', filename: 'plan.pdf' }),
      ])

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).attachmentIds).toEqual(['att-1'])
    })

    it('preserves a follow-up reminder through send and undo', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)
      store.composerFollowUpAt = '2026-08-20T09:00:00.000Z'

      store.sendEmail()
      store.undoPendingSend()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(store.composerFollowUpAt).toBe('2026-08-20T09:00:00.000Z')
    })

    it('undo cancels the send and restores the message in the composer', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)
      store.composerFollowUpAt = '2026-08-03T09:00:00.000Z'

      store.sendEmail()
      store.undoPendingSend()
      await vi.advanceTimersByTimeAsync(6000)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(store.pendingSend).toBeNull()
      expect(store.isComposerActive).toBe(true)
      expect(store.composerTo).toBe('someone@example.com')
      expect(store.composerTextArea).toBe('Checking in.')
    })

    it('undoLatestAction prioritizes a queued send', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)
      const otherUndo = vi.fn()
      store.notify('Marked done.', 'info', { label: 'Undo', run: otherUndo })

      store.sendEmail()
      await store.undoLatestAction()
      await vi.advanceTimersByTimeAsync(6000)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(otherUndo).not.toHaveBeenCalled()
      expect(store.pendingSend).toBeNull()
      expect(store.isComposerActive).toBe(true)
      expect(store.composerTextArea).toBe('Checking in.')
    })

    it('pause freezes the countdown until resumed', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(2000) // 5 -> 3
      store.pausePendingSend()
      await vi.advanceTimersByTimeAsync(10000) // frozen while paused

      expect(store.pendingSend?.secondsLeft).toBe(3)
      expect(fetchMock).not.toHaveBeenCalled()

      store.resumePendingSend()
      await vi.advanceTimersByTimeAsync(3000) // 3 -> 0

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(store.pendingSend).toBeNull()
    })

    it('restores the message in the composer if the send fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)

      store.sendEmail()
      await vi.advanceTimersByTimeAsync(5000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(store.pendingSend).toBeNull()
      expect(store.isComposerActive).toBe(true)
      expect(store.composerTextArea).toBe('Checking in.')
      expect(store.toasts.at(-1)?.message).toBe('Failed to send email. Please try again.')
      expect(consoleError).toHaveBeenCalledWith('Failed to send email:', expect.any(Error))
    })

    it('does not queue a second send while one is already pending', () => {
      stubSendOk()
      const store = useInboxStore()
      armComposer(store)

      store.sendEmail()
      // Simulate a stray second click: the composer is already closed, so
      // re-arm before calling again to prove the pendingSend guard blocks it.
      armComposer(store)
      store.sendEmail()

      expect(store.pendingSend.secondsLeft).toBe(5)
      expect(store.isComposerActive).toBe(false)
    })
  })

  describe('Send Later', () => {
    function armComposer(store) {
      store.composerTo = 'someone@example.com'
      store.composerSubject = 'Hello'
      store.composerTextArea = 'Checking in.'
    }

    it('POSTs sendAt to /api/send and closes the composer without a countdown', async () => {
      const scheduledSend = {
        id: 'sched-1',
        toAddresses: 'someone@example.com',
        subject: 'Hello',
        scheduledFor: '2026-08-02T09:00:00.000Z',
      }
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ scheduledSend }) })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)
      store.composerFollowUpAt = '2026-08-03T09:00:00.000Z'

      const result = await store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')

      expect(result).toBe(true)
      expect(store.pendingSend).toBeNull()
      expect(store.isComposerActive).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/send')
      expect(JSON.parse(options.body)).toMatchObject({
        to: 'someone@example.com',
        subject: 'Hello',
        sendAt: '2026-08-02T09:00:00.000Z',
        followUpAt: '2026-08-03T09:00:00.000Z',
      })
      expect(store.toasts.at(-1)?.message).toBe('Email scheduled for Tomorrow.')
    })

    it('converts emoji before scheduling an email', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ scheduledSend: { id: 'sched-emoji' } }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      store.composerTo = 'someone@example.com'
      store.composerSubject = 'Party 🎉'
      store.composerTextArea = 'See you there 👍'
      store.composerHtml = '<p>See you <strong>there</strong> 👍</p>'

      await store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        subject: 'Party \\o/',
        text: 'See you there +1',
        html: '<p>See you <strong>there</strong> +1</p>',
      })
    })

    it('includes carried attachment ids when scheduling a forwarded email', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ scheduledSend: { id: 'sched-forward' } }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)
      store.composerAttachments = [{ id: 'att-1', filename: 'plan.pdf' }]

      await store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).attachmentIds).toEqual(['att-1'])
    })

    it('does nothing when the composer has no valid recipient', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()

      const result = await store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')

      expect(result).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('restores the draft into the composer if scheduling fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)

      const result = await store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')

      expect(result).toBe(false)
      expect(store.isComposerActive).toBe(true)
      expect(store.composerTo).toBe('someone@example.com')
      expect(store.toasts.at(-1)?.message).toMatch(/failed/i)
      expect(consoleError).toHaveBeenCalledWith('Failed to schedule email:', expect.any(Error))
    })

    it('locks sendEmailLater with isSendingEmail for the duration of the request', async () => {
      let resolveSend
      const fetchMock = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSend = resolve
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)

      const first = store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')
      await vi.waitFor(() => expect(store.isSendingEmail).toBe(true))
      const second = await store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')
      expect(second).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      resolveSend({
        ok: true,
        json: async () => ({ scheduledSend: { id: 'sched-1' } }),
      })
      await expect(first).resolves.toBe(true)
      expect(store.isSendingEmail).toBe(false)
    })

    it('loads the pending scheduled-send queue once and caches it', async () => {
      const scheduledSends = [
        { id: 'sched-1', subject: 'Hello', scheduledFor: '2026-08-02T09:00:00.000Z' },
      ]
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ scheduledSends }) })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()

      await store.loadScheduledSends()
      await store.loadScheduledSends()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe('/api/send?resource=scheduled')
      expect(store.scheduledSends).toEqual(scheduledSends)
    })

    it('cancels a scheduled send and reopens its content in the composer', async () => {
      const canceled = {
        id: 'sched-1',
        toAddresses: 'someone@example.com',
        subject: 'Hello',
        text: 'Checking in.',
        html: '<p>Checking in.</p>',
        replyToMessageId: null,
        followUpAt: '2026-08-03T09:00:00.000Z',
        attachments: [{ id: 'att-1', filename: 'plan.pdf', size_bytes: 2048 }],
      }
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ scheduledSend: canceled }) })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      store.scheduledSends = [{ id: 'sched-1' }, { id: 'sched-2' }]

      await store.cancelScheduledSend({ id: 'sched-1' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/send?resource=scheduled',
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ id: 'sched-1' })
      expect(store.scheduledSends).toEqual([{ id: 'sched-2' }])
      expect(store.composerTo).toBe('someone@example.com')
      expect(store.composerTextArea).toBe('Checking in.')
      expect(store.composerFollowUpAt).toBe('2026-08-03T09:00:00.000Z')
      expect(store.composerAttachments).toEqual([
        expect.objectContaining({ id: 'att-1', filename: 'plan.pdf' }),
      ])
      expect(store.isComposerActive).toBe(true)
    })

    it('throws if the scheduled send can no longer be canceled', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()

      await expect(store.cancelScheduledSend({ id: 'sched-1' })).rejects.toThrow(
        'DELETE scheduled send responded 404',
      )
    })
  })

  it('finds the open email in the sent list too', async () => {
    const store = useInboxStore()
    store.sentEmails = [{ id: 'sent-1', subject: 'Re: Hello', unread: false }]
    store.messageBodies.set('sent-1', { html: null, text: 'Hi' })
    store.openEmailId = 'sent-1'
    expect(store.openEmail).toEqual(store.sentEmails[0])
  })

  it('askAssistant posts to /ask and records the answer with sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          answer: '**City Construction** sent a revised plan.',
          sources: [{ id: 'm1', subject: 'Revised Floor Plan', from_name: 'City Construction' }],
        }),
      }),
    )

    const store = useInboxStore()
    await store.askAssistant('What happened with the renovation?')

    expect(fetch).toHaveBeenCalledWith(`${SEARCH_API_URL}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ question: 'What happened with the renovation?' }),
      signal: expect.any(AbortSignal),
    })
    expect(store.isChatDrawerActive).toBe(true)
    expect(store.chatHistory).toHaveLength(2)
    expect(store.chatHistory[1]).toMatchObject({
      sender: 'ai',
      text: '**City Construction** sent a revised plan.',
    })
    expect(store.chatHistory[1].sources).toHaveLength(1)
    expect(store.isChatLoading).toBe(false)
  })

  it('askAssistant records an apology message when the API fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))

    const store = useInboxStore()
    await store.askAssistant('Anything?')

    expect(store.chatHistory[1].text).toContain("couldn't reach the assistant")
    expect(store.isChatLoading).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('Ask failed:', expect.any(Error))
  })

  it('askAssistant aborts the previous request and ignores a stale answer', async () => {
    let resolveFirst
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: 'new answer', sources: [] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    const first = store.askAssistant('old question')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await store.askAssistant('new question')

    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    resolveFirst({ ok: true, json: async () => ({ answer: 'stale answer', sources: [] }) })
    await first

    expect(
      store.chatHistory.filter((message) => message.sender === 'ai').map((message) => message.text),
    ).toEqual(['new answer'])
    expect(store.isChatLoading).toBe(false)
  })

  it('searches emails and replaces the inbox list with results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [
            {
              id: 'zoom-1',
              from_name: 'Zoom Video',
              from_address: 'billing@zoom.us',
              subject: 'Invoice for subscription renewal',
              snippet: 'Your annual Zoom Pro subscription has renewed...',
              body_text: 'Your annual Zoom Pro subscription has renewed.',
              sent_at: new Date().toISOString(),
              is_unread: false,
              is_starred: false,
            },
          ],
        }),
      }),
    )

    const store = useInboxStore()
    await store.searchEmails('  zoom invoice ')

    expect(fetch).toHaveBeenCalledWith(`${SEARCH_API_URL}/search?q=zoom%20invoice`, {
      headers: { Authorization: 'Bearer test-access-token' },
      signal: expect.any(AbortSignal),
    })
    expect(store.activeSearchQuery).toBe('zoom invoice')
    expect(store.traditionalEmails).toHaveLength(1)
    expect(store.traditionalEmails[0].subject).toBe('Invoice for subscription renewal')
    expect(store.isRefreshing).toBe(false)
  })

  it('notifies and keeps the list when search fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'keep-me' }]
    await store.searchEmails('anything')

    expect(store.traditionalEmails).toEqual([{ id: 'keep-me' }])
    expect(store.activeSearchQuery).toBe('')
    expect(store.toasts[0]).toMatchObject({ kind: 'error' })
    expect(consoleError).toHaveBeenCalledWith('Search failed:', expect.any(Error))
  })

  it('ignores a stale search response that resolves after a newer one', async () => {
    const emailRow = (id, subject) => ({
      id,
      from_name: 'Sender',
      from_address: 's@example.com',
      subject,
      snippet: '',
      body_text: '',
      sent_at: new Date().toISOString(),
      is_unread: false,
      is_starred: false,
    })
    let resolveFirst
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(firstResponse)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ emails: [emailRow('new-1', 'Newer result')] }),
        }),
    )

    const store = useInboxStore()
    const first = store.searchEmails('old query')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const firstSignal = fetch.mock.calls[0][1].signal
    await store.searchEmails('new query')
    expect(firstSignal.aborted).toBe(true)
    expect(store.traditionalEmails[0].subject).toBe('Newer result')

    // The stale response arrives late — it must not clobber the newer results.
    resolveFirst({ ok: true, json: async () => ({ emails: [emailRow('old-1', 'Stale result')] }) })
    await first

    expect(store.traditionalEmails[0].subject).toBe('Newer result')
    expect(store.activeSearchQuery).toBe('new query')
  })

  it('uses keyword-only mode when semantic search is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emails: [] }) }),
    )

    const store = useInboxStore()
    await store.searchEmails('quick result', { semantic: false })

    expect(fetch).toHaveBeenCalledWith(`${SEARCH_API_URL}/search?q=quick%20result&mode=keyword`, {
      headers: { Authorization: 'Bearer test-access-token' },
      signal: expect.any(AbortSignal),
    })
  })

  it('clearSearch reloads the full inbox only when a search is active', async () => {
    const store = useInboxStore()

    // No active search: no fetch happens.
    vi.stubGlobal('fetch', vi.fn())
    store.clearSearch()
    expect(fetch).not.toHaveBeenCalled()

    // Active search: clearing reloads /api/emails.
    store.activeSearchQuery = 'zoom'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emails: [] }) }),
    )
    await store.clearSearch()
    expect(store.activeSearchQuery).toBe('')
    expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails?limit=50`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
  })

  it('clearSearch invalidates a search that is still in flight', async () => {
    let resolveSearch
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveSearch = resolve
        }),
      ),
    )

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'existing-email' }]
    const searchRequest = store.searchEmails('zoom')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    store.clearSearch()
    resolveSearch({
      ok: true,
      json: async () => ({ emails: [{ id: 'stale-search-result' }] }),
    })
    await searchRequest

    expect(store.activeSearchQuery).toBe('')
    expect(store.traditionalEmails).toEqual([{ id: 'existing-email' }])
    expect(store.isRefreshing).toBe(false)
  })

  it('renames a label and updates labels on loaded emails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          label: {
            id: 'label-1',
            name: 'Money',
            color: '#2f9e44',
            kind: 'user',
            description: 'Bills',
            auto_apply: true,
          },
        }),
      }),
    )

    const store = useInboxStore()
    const label = {
      id: 'label-1',
      name: 'Finance',
      color: '#2f9e44',
      kind: 'user',
      description: 'Bills',
      auto_apply: true,
      message_count: 2,
    }
    store.labels = [label]
    store.traditionalEmails = [{ id: 'mail-1', labels: [{ name: 'Finance', color: '#2f9e44' }] }]
    store.sentEmails = [{ id: 'mail-2', labels: [{ name: 'Finance', color: '#2f9e44' }] }]
    store.inboxTab = 'label:Finance'

    await expect(store.renameLabel(label, '  Money  ')).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledWith(`${LABELS_API_URL}/labels`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'label-1', name: 'Money' }),
    })
    expect(store.labels.find((item) => item.id === 'label-1')).toMatchObject({
      name: 'Money',
      message_count: 2,
    })
    expect(store.traditionalEmails[0].labels[0].name).toBe('Money')
    expect(store.sentEmails[0].labels[0].name).toBe('Money')
    expect(store.inboxTab).toBe('label:Money')
    expect(store.toasts.at(-1)?.message).toBe('Label renamed.')
  })

  it('loads tag rules from the API', async () => {
    const rule = {
      id: 'rule-1',
      name: 'Bills',
      label_id: 'label-1',
      match_type: 'all',
      enabled: true,
      conditions: [{ id: 'c1', field: 'subject', operator: 'contains', value: 'invoice' }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: [rule] }) }),
    )

    const store = useInboxStore()
    await store.loadRules()

    expect(fetch).toHaveBeenCalledWith(`${LABELS_API_URL}/labels/rules`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.rules).toEqual([rule])
  })

  it('creates a tag rule', async () => {
    const rule = {
      id: 'rule-1',
      name: 'Bills',
      label_id: 'label-1',
      match_type: 'all',
      enabled: true,
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice', position: 0 }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rule }) }))

    const store = useInboxStore()
    const payload = {
      name: 'Bills',
      label_id: 'label-1',
      match_type: 'all',
      conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
    }
    await expect(store.createRule(payload)).resolves.toEqual(rule)

    expect(fetch).toHaveBeenCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-access-token' },
      body: JSON.stringify(payload),
    })
    expect(store.rules).toEqual([rule])
    expect(store.toasts.at(-1)?.message).toBe('Rule created.')
  })

  it('returns null and notifies when creating a rule fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const store = useInboxStore()
    await expect(store.createRule({ label_id: 'label-1', conditions: [] })).resolves.toBeNull()
    expect(store.toasts.at(-1)?.message).toBe('Failed to create rule.')
    expect(consoleError).toHaveBeenCalledWith('Failed to create rule:', expect.any(Error))
  })

  it('updates a rule and rolls back on failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rule = { id: 'rule-1', name: 'Bills', enabled: true }
    const store = useInboxStore()
    store.rules = [rule]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(store.updateRule(rule, { enabled: false })).resolves.toBe(false)
    expect(rule.enabled).toBe(true)
    expect(store.toasts.at(-1)?.message).toBe('Failed to update rule.')
    expect(consoleError).toHaveBeenCalledWith('Failed to update rule:', expect.any(Error))

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ rule: { ...rule, enabled: false } }) }),
    )
    await expect(store.updateRule(rule, { enabled: false })).resolves.toBe(true)
    expect(rule.enabled).toBe(false)
    expect(fetch).toHaveBeenCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-access-token' },
      body: JSON.stringify({ id: 'rule-1', enabled: false }),
    })
  })

  it('deletes a rule', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const store = useInboxStore()
    store.rules = [{ id: 'rule-1' }, { id: 'rule-2' }]
    await store.deleteRule('rule-1')

    expect(fetch).toHaveBeenCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-access-token' },
      body: JSON.stringify({ id: 'rule-1' }),
    })
    expect(store.rules).toEqual([{ id: 'rule-2' }])
    expect(store.toasts.at(-1)?.message).toBe('Rule deleted.')
  })

  it('shows a toast and auto-dismisses it', () => {
    vi.useFakeTimers()
    const store = useInboxStore()

    store.notify('Reply sent.')
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0]).toMatchObject({ message: 'Reply sent.', kind: 'info' })

    vi.advanceTimersByTime(4000)
    expect(store.toasts).toHaveLength(0)
    vi.useRealTimers()
  })

  it('dismisses a toast manually', () => {
    vi.useFakeTimers()
    const store = useInboxStore()

    store.notify('Failed to send email.', 'error')
    store.dismissToast(store.toasts[0].id)
    expect(store.toasts).toHaveLength(0)
    vi.useRealTimers()
  })

  it('runs a toast action and dismisses the toast', async () => {
    const store = useInboxStore()
    const run = vi.fn()
    const id = store.notify('Deleted.', 'info', { label: 'Undo', run })

    await store.runToastAction(id)

    expect(run).toHaveBeenCalledTimes(1)
    expect(store.toasts).toHaveLength(0)
  })

  it('undoLatestAction runs the newest actionable toast', async () => {
    const store = useInboxStore()
    const olderUndo = vi.fn()
    const newerUndo = vi.fn()
    store.notify('Informational only.')
    store.notify('Marked done.', 'info', { label: 'Undo', run: olderUndo })
    store.notify('Deleted.', 'info', { label: 'Undo', run: newerUndo })

    await expect(store.undoLatestAction()).resolves.toBe(true)

    expect(newerUndo).toHaveBeenCalledTimes(1)
    expect(olderUndo).not.toHaveBeenCalled()
    expect(store.toasts.some((toast) => toast.message === 'Deleted.')).toBe(false)
  })

  it('sends mail through the API with the access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) }),
    )

    const store = useInboxStore()
    const result = await store.sendMail({
      to: 'someone@example.com',
      subject: 'Re: Hello',
      text: 'Hi there',
      followUpAt: '2026-08-20T09:00:00.000Z',
    })

    expect(fetch).toHaveBeenCalledWith('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: expect.any(String),
    })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      to: 'someone@example.com',
      subject: 'Re: Hello',
      text: 'Hi there',
      followUpAt: '2026-08-20T09:00:00.000Z',
      requestId: expect.any(String),
    })
    expect(result).toEqual({ id: 'msg-1' })
  })

  it('sets and clears a follow-up reminder across loaded mailboxes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { id: 'sent-1', followUpAt: '2026-08-20T09:00:00.000Z' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { id: 'sent-1', followUpAt: null } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    const inboxEmail = { id: 'sent-1', isSent: true, followUpAt: null }
    const sentEmail = { id: 'sent-1', isSent: true, followUpAt: null }
    store.traditionalEmails = [inboxEmail]
    store.sentEmails = [sentEmail]

    await store.setMessageFollowUp(inboxEmail, '2026-08-20T09:00:00.000Z')

    expect(inboxEmail.followUpAt).toBe('2026-08-20T09:00:00.000Z')
    expect(sentEmail.followUpAt).toBe('2026-08-20T09:00:00.000Z')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/send?resource=follow-up', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({
        messageId: 'sent-1',
        followUpAt: '2026-08-20T09:00:00.000Z',
      }),
    })

    await store.setMessageFollowUp(inboxEmail, null)

    expect(store.traditionalEmails).toEqual([])
    expect(sentEmail.followUpAt).toBeNull()
  })

  it('throws when sending mail fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))

    const store = useInboxStore()
    await expect(
      store.sendMail({ to: 'someone@example.com', subject: 'S', text: 'T' }),
    ).rejects.toThrow('POST /api/send responded 502')
  })

  it('persists read state and updates the unread count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )

    const store = useInboxStore()
    const email = { id: 'abc-123', unread: true }
    store.traditionalEmails = [email, { id: 'def-456', unread: true }]
    store.unreadInboxCount = 2

    store.setUnread(email, false)
    expect(email.unread).toBe(false)
    expect(store.unreadInboxCount).toBe(1)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())

    expect(fetch).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'abc-123', is_unread: false }),
    })
  })

  it('reverts read state when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useInboxStore()
    const email = { id: 'abc-123', unread: true }
    store.traditionalEmails = [email]
    store.unreadInboxCount = 1

    store.setUnread(email, false)
    await vi.waitFor(() => expect(email.unread).toBe(true))
    expect(store.unreadInboxCount).toBe(1)
    expect(store.toasts.some((t) => t.kind === 'error')).toBe(true)
  })

  it('openReader marks the email read and exposes it via the openEmail getter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )

    const store = useInboxStore()
    const email = { id: 'abc-123', unread: true }
    store.traditionalEmails = [email]
    store.unreadInboxCount = 1

    store.openReader(email)
    expect(store.openEmailId).toBe('abc-123')
    expect(store.openEmail).toStrictEqual(email)
    expect(email.unread).toBe(false)

    store.closeReader()
    expect(store.openEmailId).toBe(null)
    expect(store.openEmail).toBe(null)
  })

  it('openEmailFromSearch maps and splices a /search row into traditionalEmails, then opens it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )

    const store = useInboxStore()
    store.traditionalEmails = []
    const row = {
      id: 'search-1',
      subject: 'From search',
      from_name: 'Ada',
      from_address: 'ada@example.com',
      sent_at: '2026-01-01T00:00:00Z',
      is_unread: true,
    }

    store.openEmailFromSearch(row)

    expect(store.openEmailId).toBe('search-1')
    expect(store.openEmail.subject).toBe('From search')
    expect(store.openEmail.unread).toBe(false)
    expect(store.traditionalEmails).toHaveLength(1)
  })

  it('openEmailFromSearch reuses the already-loaded row instead of duplicating it', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )

    const store = useInboxStore()
    const existing = { id: 'e-1', subject: 'Loaded', unread: true }
    store.traditionalEmails = [existing]

    store.openEmailFromSearch({ id: 'e-1', subject: 'Stale copy from the index' })

    expect(store.traditionalEmails).toHaveLength(1)
    expect(store.openEmail).toStrictEqual(existing)
    expect(store.openEmail.subject).toBe('Loaded')
  })

  it('openEmail getter returns null once the email leaves the list', () => {
    const store = useInboxStore()
    const email = { id: 'abc-123', unread: false }
    store.traditionalEmails = [email]
    store.openEmailId = email.id

    store.traditionalEmails = []
    expect(store.openEmail).toBe(null)
  })

  it('archiveEmail offers Undo that restores the row and unread state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )

    const store = useInboxStore()
    const email = { id: 'abc-123', unread: true }
    store.traditionalEmails = [email, { id: 'def-456', unread: false }]
    store.unreadInboxCount = 1
    store.openEmailId = email.id

    store.archiveEmail(email)
    expect(store.traditionalEmails.map((e) => e.id)).toEqual(['def-456'])
    expect(store.openEmailId).toBe(null)
    expect(store.unreadInboxCount).toBe(0)

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-access-token',
        },
        body: JSON.stringify({ id: 'abc-123', is_archived: true, is_unread: false }),
      }),
    )

    const toast = store.toasts.find((item) => item.message === 'Marked done.')
    expect(toast.action.label).toBe('Undo')
    await store.runToastAction(toast.id)

    expect(store.traditionalEmails.map((e) => e.id)).toEqual(['abc-123', 'def-456'])
    expect(email.unread).toBe(true)
    expect(store.unreadInboxCount).toBe(1)
    expect(fetch).toHaveBeenLastCalledWith(`${MESSAGES_API_URL}/messages`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'abc-123', is_archived: false, is_unread: true }),
    })
  })

  describe('setSpam', () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-access-token',
    }

    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
      )
    })

    it('reporting spam moves the email from the inbox to Spam, keeps it unread, and offers Undo', async () => {
      const store = useInboxStore()
      const email = { id: 'abc-123', unread: true, isSpam: false, scheduledFor: null }
      store.traditionalEmails = [email, { id: 'def-456', unread: false, isSpam: false }]
      store.isInboxLoaded = true
      store.isSpamLoaded = true
      store.spamEmails = [{ id: 'old-spam', unread: false, isSpam: true }]
      store.unreadInboxCount = 1
      store.openEmailId = email.id

      store.setSpam(email, true)

      expect(store.traditionalEmails.map((e) => e.id)).toEqual(['def-456'])
      expect(store.spamEmails.map((e) => e.id)).toEqual(['abc-123', 'old-spam'])
      expect(email.isSpam).toBe(true)
      expect(email.unread).toBe(true)
      expect(store.unreadInboxCount).toBe(0)
      expect(store.openEmailId).toBe(null)

      await vi.waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ id: 'abc-123', is_spam: true }),
        }),
      )

      const toast = store.toasts.find((item) => item.message === 'Reported as spam.')
      expect(toast.action.label).toBe('Undo')
      await store.runToastAction(toast.id)

      expect(store.traditionalEmails.map((e) => e.id)).toEqual(['abc-123', 'def-456'])
      expect(store.spamEmails.map((e) => e.id)).toEqual(['old-spam'])
      expect(email.isSpam).toBe(false)
      expect(store.unreadInboxCount).toBe(1)
      expect(fetch).toHaveBeenLastCalledWith(`${MESSAGES_API_URL}/messages`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: 'abc-123', is_spam: false }),
      })
    })

    it('marking not spam returns the email to the loaded inbox and counts it unread again', async () => {
      const store = useInboxStore()
      const email = { id: 'abc-123', unread: true, isSpam: true, scheduledFor: null }
      store.spamEmails = [email]
      store.isSpamLoaded = true
      store.traditionalEmails = [{ id: 'def-456', unread: false, isSpam: false }]
      store.isInboxLoaded = true
      store.unreadInboxCount = 0

      store.setSpam(email, false)

      expect(store.spamEmails).toEqual([])
      expect(store.traditionalEmails.map((e) => e.id)).toEqual(['abc-123', 'def-456'])
      expect(email.isSpam).toBe(false)
      expect(store.unreadInboxCount).toBe(1)
      await vi.waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ id: 'abc-123', is_spam: false }),
        }),
      )
      expect(store.toasts.some((item) => item.message === 'Marked not spam.')).toBe(true)
    })

    it('marking not spam sends a still-snoozed email to Snoozed rather than the inbox', async () => {
      const store = useInboxStore()
      const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const email = { id: 'snoozed-1', unread: true, isSpam: true, scheduledFor: soon }
      store.spamEmails = [email]
      store.isSpamLoaded = true
      store.traditionalEmails = []
      store.isInboxLoaded = true
      store.snoozedEmails = []
      store.isSnoozedLoaded = true
      store.unreadInboxCount = 0

      store.setSpam(email, false)

      expect(store.traditionalEmails).toEqual([])
      expect(store.snoozedEmails.map((e) => e.id)).toEqual(['snoozed-1'])
      expect(store.unreadInboxCount).toBe(0)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    })

    it('leaves Starred and label lists alone: they show spam too', async () => {
      const store = useInboxStore()
      const email = { id: 'starred-1', unread: false, isSpam: false, scheduledFor: null }
      store.traditionalEmails = [email]
      store.starredEmails = [email]
      store.isStarredLoaded = true
      store.labelEmails = [email]
      store.isLabelLoaded = true

      store.setSpam(email, true)

      expect(store.traditionalEmails).toEqual([])
      expect(store.starredEmails).toEqual([email])
      expect(store.labelEmails).toEqual([email])
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    })

    it('reporting from Starred also drops the inbox copy of the same message', async () => {
      const store = useInboxStore()
      const inboxCopy = { id: 'copy-1', unread: true, isSpam: false, scheduledFor: null }
      const starredCopy = { id: 'copy-1', unread: true, isSpam: false, scheduledFor: null }
      store.traditionalEmails = [inboxCopy]
      store.isInboxLoaded = true
      store.starredEmails = [starredCopy]
      store.isStarredLoaded = true
      store.unreadInboxCount = 1

      store.setSpam(starredCopy, true)

      expect(store.traditionalEmails).toEqual([])
      expect(store.starredEmails).toEqual([starredCopy])
      expect(inboxCopy.isSpam).toBe(true)
      expect(store.unreadInboxCount).toBe(0)

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      const toast = store.toasts.find((item) => item.message === 'Reported as spam.')
      await store.runToastAction(toast.id)

      expect(store.traditionalEmails).toEqual([inboxCopy])
      expect(inboxCopy.isSpam).toBe(false)
      expect(store.unreadInboxCount).toBe(1)
    })

    it('a failed earlier request does not roll back a newer toggle', async () => {
      let failFirst
      const first = new Promise((resolve) => {
        failFirst = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementationOnce(() => first)
          .mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
      )
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = useInboxStore()
      const email = { id: 'toggle-1', unread: false, isSpam: false, scheduledFor: null }
      store.starredEmails = [email]
      store.isStarredLoaded = true
      store.spamCount = 0

      store.setSpam(email, true, false)
      store.setSpam(email, false, false)
      store.setSpam(email, true, false)
      expect(email.isSpam).toBe(true)
      expect(store.spamCount).toBe(1)

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      failFirst({ ok: false, status: 500 })
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))

      expect(email.isSpam).toBe(true)
      expect(store.spamCount).toBe(1)
    })

    it('reverts the move and reports when the PATCH fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = useInboxStore()
      const email = { id: 'abc-123', unread: true, isSpam: false, scheduledFor: null }
      store.traditionalEmails = [email]
      store.isInboxLoaded = true
      store.unreadInboxCount = 1

      store.setSpam(email, true)
      expect(store.traditionalEmails).toEqual([])

      await vi.waitFor(() => expect(store.traditionalEmails).toEqual([email]))
      expect(email.isSpam).toBe(false)
      expect(store.unreadInboxCount).toBe(1)
      expect(store.toasts.some((item) => item.message === 'Failed to report spam.')).toBe(true)
    })

    it('keeps the Spam folder count in step with the verdict, and with Undo', async () => {
      const store = useInboxStore()
      const email = { id: 'count-1', unread: false, isSpam: false, scheduledFor: null }
      store.traditionalEmails = [email]
      store.isInboxLoaded = true
      store.spamCount = 0

      store.setSpam(email, true)
      expect(store.spamCount).toBe(1)

      await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
      const toast = store.toasts.find((item) => item.message === 'Reported as spam.')
      await store.runToastAction(toast.id)
      expect(store.spamCount).toBe(0)

      store.setSpam(email, true)
      store.setSpam(email, false)
      expect(store.spamCount).toBe(0)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    })

    it('sends rapid opposite verdicts in click order, one at a time', async () => {
      let releaseFirst
      const first = new Promise((resolve) => {
        releaseFirst = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementationOnce(() => first)
          .mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
      )
      const store = useInboxStore()
      const email = { id: 'order-1', unread: false, isSpam: false, scheduledFor: null }
      store.starredEmails = [email]
      store.isStarredLoaded = true

      store.setSpam(email, true, false)
      store.setSpam(email, false, false)

      // The second PATCH waits for the first, however long it takes.
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ id: 'order-1', is_spam: true })

      releaseFirst({ ok: true, json: async () => ({ message: {} }) })
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ id: 'order-1', is_spam: false })
      expect(email.isSpam).toBe(false)
    })

    it('during a search leaves the result in place and the inbox badge alone', async () => {
      const store = useInboxStore()
      const email = { id: 'search-1', unread: true, isSpam: false, scheduledFor: null }
      store.activeSearchQuery = 'invoice'
      store.traditionalEmails = [email]
      store.isInboxLoaded = true
      store.unreadInboxCount = 3
      store.spamCount = 0

      store.setSpam(email, true)

      expect(store.traditionalEmails).toEqual([email])
      expect(store.unreadInboxCount).toBe(3)
      expect(email.isSpam).toBe(true)
      expect(store.spamCount).toBe(1)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    })

    it('changes no folder count for archived mail, which neither folder lists', async () => {
      const store = useInboxStore()
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const email = {
        id: 'archived-1',
        unread: false,
        isSpam: false,
        isPriority: false,
        isArchived: true,
        scheduledFor: future,
      }
      store.starredEmails = [email]
      store.isStarredLoaded = true
      store.isSpamLoaded = true
      store.spamEmails = []
      store.spamCount = 2
      store.snoozedCount = 2

      store.setSpam(email, true)

      expect(store.spamCount).toBe(2)
      expect(store.snoozedCount).toBe(2)
      expect(store.spamEmails).toEqual([])
      expect(email.isSpam).toBe(true)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    })

    it('is a no-op when the email already carries that verdict', () => {
      const store = useInboxStore()
      const email = { id: 'abc-123', unread: false, isSpam: true }
      store.spamEmails = [email]

      expect(store.setSpam(email, true)).toBe(null)
      expect(store.spamEmails).toEqual([email])
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('spamCount', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
      )
    })

    it('is taken from the inbox state bootstrap', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ unreadCount: 2, spamCount: 5, userId: 'user-1' }),
        }),
      )
      const store = useInboxStore()
      await store.loadInboxState()
      expect(store.spamCount).toBe(5)
    })

    it('is refreshed with every first inbox page so new spam surfaces the folder', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ emails: [], nextCursor: null, unreadCount: 0, spamCount: 3 }),
        }),
      )
      const store = useInboxStore()
      await store.loadEmails()
      expect(store.spamCount).toBe(3)

      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ emails: [], nextCursor: null, unreadCount: 0, spamCount: 0 }),
      })
      await store.refreshInboxEmails()
      expect(store.spamCount).toBe(0)
    })

    it('is left alone by a payload without the field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ unreadCount: 2, userId: 'user-1' }),
        }),
      )
      const store = useInboxStore()
      store.spamCount = 4
      await store.loadInboxState()
      expect(store.spamCount).toBe(4)
    })

    it('trusts a fully loaded Spam folder over the cached count', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            emails: [{ id: 'a', sent_at: '2026-07-13T12:00:00.000Z', spam_verdict: 'spam' }],
            nextCursor: null,
          }),
        }),
      )
      const store = useInboxStore()
      store.spamCount = 9
      await store.loadSpamEmails()
      expect(store.spamCount).toBe(1)
      expect(store.isSpamLoaded).toBe(true)
    })

    it('drops when a spam email is marked Done or deleted, and returns on Undo', async () => {
      const store = useInboxStore()
      const done = { id: 'abc-123', unread: false, isSpam: true }
      const trashed = { id: 'def-456', unread: false, isSpam: true }
      store.spamEmails = [done, trashed]
      store.spamCount = 2

      store.archiveEmail(done)
      expect(store.spamCount).toBe(1)
      store.deleteEmail(trashed)
      expect(store.spamCount).toBe(0)

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      for (const message of ['Marked done.', 'Deleted.']) {
        const toast = store.toasts.find((item) => item.message === message)
        await store.runToastAction(toast.id)
      }
      expect(store.spamCount).toBe(2)
    })

    it('does not drop when already-archived spam is marked Done again from Starred', async () => {
      const store = useInboxStore()
      const done = { id: 'abc-123', unread: false, isSpam: true, isArchived: true }
      const trashed = { id: 'def-456', unread: false, isSpam: true, isArchived: true }
      store.starredEmails = [done, trashed]
      store.isStarredLoaded = true
      store.spamCount = 1

      store.archiveEmail(done)
      store.deleteEmail(trashed)
      expect(store.spamCount).toBe(1)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    })

    it('does not drop when a non-spam email is marked Done', async () => {
      const store = useInboxStore()
      const email = { id: 'abc-123', unread: false, isSpam: false }
      store.traditionalEmails = [email]
      store.spamCount = 1

      store.archiveEmail(email)
      expect(store.spamCount).toBe(1)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    })
  })

  describe('snoozedCount', () => {
    const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
      )
    })

    it('is taken from the inbox state bootstrap and left alone when absent', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ unreadCount: 0, snoozedCount: 4, userId: 'user-1' }),
        }),
      )
      const store = useInboxStore()
      await store.loadInboxState()
      expect(store.snoozedCount).toBe(4)

      fetch.mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 0 }) })
      await store.loadInboxState({ force: true })
      expect(store.snoozedCount).toBe(4)
    })

    it('rises when an email is snoozed and falls again on Undo', async () => {
      const store = useInboxStore()
      const email = { id: 'abc-123', unread: false, scheduledFor: null }
      store.traditionalEmails = [email]
      store.snoozedCount = 0

      await store.scheduleEmail(email, future(), 'Tomorrow')
      expect(store.snoozedCount).toBe(1)

      const toast = store.toasts.find((item) => item.message === 'Scheduled for Tomorrow.')
      await store.runToastAction(toast.id)
      expect(store.snoozedCount).toBe(0)
    })

    it('does not double-count a re-snooze of an already snoozed email', async () => {
      const store = useInboxStore()
      const email = { id: 'abc-123', unread: false, scheduledFor: future() }
      store.snoozedEmails = [email]
      store.snoozedCount = 1

      await store.scheduleEmail(email, future(), 'Next week')
      expect(store.snoozedCount).toBe(1)
    })

    it('drops when a snoozed email is marked Done or deleted, and returns on Undo', async () => {
      const store = useInboxStore()
      const done = { id: 'abc-123', unread: false, scheduledFor: future() }
      const trashed = { id: 'def-456', unread: false, scheduledFor: future() }
      store.snoozedEmails = [done, trashed]
      store.snoozedCount = 2

      store.archiveEmail(done)
      expect(store.snoozedCount).toBe(1)
      store.deleteEmail(trashed)
      expect(store.snoozedCount).toBe(0)

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      for (const message of ['Marked done.', 'Deleted.']) {
        const toast = store.toasts.find((item) => item.message === message)
        await store.runToastAction(toast.id)
      }
      expect(store.snoozedCount).toBe(2)
    })

    it('ignores a due-in-the-past scheduled time: that email is back in the inbox', async () => {
      const store = useInboxStore()
      const past = new Date(Date.now() - 60_000).toISOString()
      const email = { id: 'abc-123', unread: false, scheduledFor: past }
      store.traditionalEmails = [email]
      store.snoozedCount = 0

      store.archiveEmail(email)
      expect(store.snoozedCount).toBe(0)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    })

    it('moves with the spam verdict, since Snoozed never lists spam', async () => {
      const store = useInboxStore()
      const email = { id: 'snooze-spam-1', unread: false, isSpam: false, scheduledFor: future() }
      store.snoozedEmails = [email]
      store.isSnoozedLoaded = true
      store.snoozedCount = 1

      store.setSpam(email, true)
      expect(store.snoozedCount).toBe(0)

      store.setSpam(email, false)
      expect(store.snoozedCount).toBe(1)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    })

    it('trusts a fully loaded Snoozed folder over the cached count', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            emails: [{ id: 'a', sent_at: '2026-07-13T12:00:00.000Z' }],
            nextCursor: null,
          }),
        }),
      )
      const store = useInboxStore()
      store.snoozedCount = 9
      await store.loadSnoozedEmails()
      expect(store.snoozedCount).toBe(1)
    })
  })

  describe('scheduledSendCount', () => {
    it('counts the pending Send Later queue', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ scheduledSends: [{ id: 'a' }, { id: 'b' }] }),
        }),
      )
      const store = useInboxStore()
      expect(store.scheduledSendCount).toBe(0)

      await store.loadScheduledSends()
      expect(store.scheduledSendCount).toBe(2)
    })
  })

  describe('spam retention', () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-access-token',
    }

    it('loads the stored retention and its bounds once', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ spamRetentionDays: 14, defaultDays: 30, minDays: 1, maxDays: 365 }),
        }),
      )
      const store = useInboxStore()
      await store.loadSpamRetention()
      await store.loadSpamRetention()

      expect(store.spamRetentionDays).toBe(14)
      expect(store.spamRetentionBounds).toEqual({ defaultDays: 30, minDays: 1, maxDays: 365 })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails/spam-retention`, {
        headers: { Authorization: 'Bearer test-access-token' },
      })
    })

    it('keeps the default and stays quiet when the load fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = useInboxStore()
      await store.loadSpamRetention()

      expect(store.spamRetentionDays).toBe(30)
      expect(store.spamRetentionLoaded).toBe(false)
      expect(store.toasts).toEqual([])
    })

    it('saves through PUT and adopts the server-normalized value', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ spamRetentionDays: 7, defaultDays: 30, minDays: 1, maxDays: 365 }),
        }),
      )
      const store = useInboxStore()
      await expect(store.saveSpamRetention(7.9)).resolves.toBe(7)

      expect(store.spamRetentionDays).toBe(7)
      expect(fetch).toHaveBeenCalledWith(`${EMAILS_API_URL}/emails/spam-retention`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ spamRetentionDays: 7.9 }),
      })
    })

    it('lets a save that finishes first win over a slow initial load', async () => {
      let releaseLoad
      const load = new Promise((resolve) => {
        releaseLoad = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementationOnce(() => load)
          .mockResolvedValue({
            ok: true,
            json: async () => ({
              spamRetentionDays: 14,
              defaultDays: 30,
              minDays: 1,
              maxDays: 365,
            }),
          }),
      )
      const store = useInboxStore()
      const loading = store.loadSpamRetention()
      await store.saveSpamRetention(14)
      expect(store.spamRetentionDays).toBe(14)

      releaseLoad({
        ok: true,
        json: async () => ({ spamRetentionDays: 30, defaultDays: 30, minDays: 1, maxDays: 365 }),
      })
      await loading
      expect(store.spamRetentionDays).toBe(14)
    })

    it('throws on a rejected save and leaves the stored value alone', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))
      const store = useInboxStore()
      store.spamRetentionDays = 30

      await expect(store.saveSpamRetention(0)).rejects.toThrow('400')
      expect(store.spamRetentionDays).toBe(30)
    })
  })

  it('mapEmailRow exposes the spam verdict as isSpam', () => {
    const sentAt = '2026-07-13T12:00:00.000Z'
    expect(mapEmailRow({ id: 'a', sent_at: sentAt, spam_verdict: 'spam' }).isSpam).toBe(true)
    expect(mapEmailRow({ id: 'b', sent_at: sentAt, spam_verdict: 'review' }).isSpam).toBe(false)
    expect(mapEmailRow({ id: 'c', sent_at: sentAt }).isSpam).toBe(false)
  })

  it('deleteEmail offers Undo that restores every list position', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
    const store = useInboxStore()
    const email = { id: 'abc-123', unread: true }
    store.traditionalEmails = [{ id: 'before' }, email, { id: 'after' }]
    store.sentEmails = [email]
    store.unreadInboxCount = 1

    store.deleteEmail(email)

    expect(store.traditionalEmails.map((item) => item.id)).toEqual(['before', 'after'])
    expect(store.sentEmails).toEqual([])
    expect(store.unreadInboxCount).toBe(0)
    const toast = store.toasts.find((item) => item.message === 'Deleted.')
    expect(toast.action.label).toBe('Undo')

    await store.runToastAction(toast.id)

    expect(store.traditionalEmails.map((item) => item.id)).toEqual(['before', 'abc-123', 'after'])
    expect(store.sentEmails).toEqual([email])
    expect(store.unreadInboxCount).toBe(1)
    expect(fetch).toHaveBeenLastCalledWith(`${MESSAGES_API_URL}/messages`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'abc-123', is_deleted: false }),
    })
  })

  it('toggleStar flips optimistically and reverts on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useInboxStore()
    const email = { id: 'abc-123', starred: false }
    store.traditionalEmails = [email]

    store.toggleStar(email)
    expect(email.starred).toBe(true)

    await vi.waitFor(() => expect(email.starred).toBe(false))
    expect(store.toasts.some((t) => t.kind === 'error')).toBe(true)
  })

  it('serializes rapid toggleStar calls so PATCHes reach the server in click order', async () => {
    let resolveFirst
    const first = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: {} }) })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    const email = { id: 'abc-123', starred: false }
    store.traditionalEmails = [email]

    store.toggleStar(email)
    expect(email.starred).toBe(true)
    store.toggleStar(email)
    expect(email.starred).toBe(false)

    // The second PATCH must not be sent until the first one settles - two
    // in-flight requests could reach the server in either order.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(1)

    resolveFirst({ ok: true, json: async () => ({ message: {} }) })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ id: 'abc-123', is_starred: true }))
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ id: 'abc-123', is_starred: false }))
  })

  it('adds and removes a starred-folder row as soon as star state changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
    const store = useInboxStore()
    const email = { id: 'abc-123', starred: false }
    store.traditionalEmails = [email]
    store.isStarredLoaded = true

    store.toggleStar(email)
    expect(store.starredEmails).toEqual([email])

    store.toggleStar(email)
    expect(store.starredEmails).toEqual([])
  })

  it('notifies when the inbox fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useInboxStore()
    await store.loadEmails()

    expect(store.traditionalEmails).toEqual([])
    expect(store.toasts.some((t) => t.kind === 'error')).toBe(true)
    expect(store.isRefreshing).toBe(false)
  })

  it('fetchMessageBody loads the body on demand and caches it by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '11111111-1111-1111-1111-111111111111',
        body_html: '<p>Hello</p>',
        body_text: 'Hello',
        summary: 'The saved project update.',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    const body = await store.fetchMessageBody('11111111-1111-1111-1111-111111111111')

    expect(body).toEqual({
      html: '<p>Hello</p>',
      text: 'Hello',
      unsubscribe: null,
      thread: [],
      attachments: [],
    })
    store.traditionalEmails = [{ id: '11111111-1111-1111-1111-111111111111' }]
    store.openEmailId = '11111111-1111-1111-1111-111111111111'
    expect(store.openEmailSummary).toBe('The saved project update.')
    expect(fetchMock).toHaveBeenCalledWith(
      `${MESSAGES_API_URL}/messages?id=11111111-1111-1111-1111-111111111111`,
      { headers: { Authorization: 'Bearer test-access-token' } },
    )

    // Second call for the same id is served from cache — no second request.
    const again = await store.fetchMessageBody('11111111-1111-1111-1111-111111111111')
    expect(again).toEqual({
      html: '<p>Hello</p>',
      text: 'Hello',
      unsubscribe: null,
      thread: [],
      attachments: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetchMessageBody shares one request between concurrent calls for the same id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', body_html: '<p>Hi</p>', body_text: 'Hi' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    // openReader and the view's openEmailId watcher both call this in the same
    // tick, before the cache has filled — only one request may go out.
    const [first, second] = await Promise.all([
      store.fetchMessageBody('msg-1'),
      store.fetchMessageBody('msg-1'),
    ])

    expect(first).toEqual({
      html: '<p>Hi</p>',
      text: 'Hi',
      unsubscribe: null,
      thread: [],
      attachments: [],
    })
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A different id after settle still fetches normally.
    await store.fetchMessageBody('msg-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fetchMessageBody retries after a failed fetch instead of caching the in-flight rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-1', body_html: '<p>Hi</p>', body_text: 'Hi' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    expect(await store.fetchMessageBody('msg-1')).toBeNull()
    // The settled in-flight entry must not pin the failure — a later open retries.
    const body = await store.fetchMessageBody('msg-1')
    expect(body).toEqual({
      html: '<p>Hi</p>',
      text: 'Hi',
      unsubscribe: null,
      thread: [],
      attachments: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith('Failed to load message body:', expect.any(Error))
  })

  it('fetchMessageBody normalizes a null HTML body and exposes it via openEmailHtml', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'abc', body_html: null, body_text: 'plain only' }),
      }),
    )

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'abc', body: 'plain only' }]
    store.openEmailId = 'abc'
    await store.fetchMessageBody('abc')

    expect(store.messageBodies.get('abc')).toEqual({
      html: null,
      text: 'plain only',
      unsubscribe: null,
      thread: [],
      attachments: [],
    })
    expect(store.openEmailHtml).toBe(null)
    expect(store.openEmailText).toBe('plain only')
  })

  it('caches a structured calendar invite and exposes it for the open message', async () => {
    const calendarInvite = {
      title: 'Whitburn Recycling Centre',
      description: 'Booking 1292383',
      location: 'Whitburn Recycling Centre',
      start_at: '2026-09-02T14:00:00Z',
      end_at: '2026-09-02T14:30:00Z',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'invite-1',
          body_text: 'Booking',
          calendar_invite: calendarInvite,
        }),
      }),
    )

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'invite-1', body: 'Booking' }]
    store.openEmailId = 'invite-1'
    await store.fetchMessageBody('invite-1')

    expect(store.messageBodies.get('invite-1').calendarInvite).toEqual(calendarInvite)
    expect(store.openEmailCalendarInvite).toEqual(calendarInvite)
  })

  it('openEmailConversation exposes the whole thread, oldest first, once the body fetch lands', async () => {
    const thread = [
      {
        id: 'msg-1',
        from_name: 'Alice',
        snippet: 'First message',
        sent_at: '2026-01-01T00:00:00Z',
      },
      { id: 'msg-2', from_name: 'Bob', snippet: 'Latest reply', sent_at: '2026-01-02T00:00:00Z' },
      { id: 'msg-3', from_name: 'Alice', snippet: 'Newer reply', sent_at: '2026-01-03T00:00:00Z' },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'msg-2', body_html: null, body_text: 'Latest reply', thread }),
      }),
    )

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'msg-2', body: 'Latest reply' }]
    store.openEmailId = 'msg-2'
    expect(store.openEmailConversation).toEqual([])

    await store.fetchMessageBody('msg-2')

    expect(store.openEmailConversation).toEqual(thread)
  })

  it('openEmailConversation is empty when the open message is alone in its thread', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'msg-1',
          body_html: null,
          body_text: 'Only message',
          thread: [{ id: 'msg-1', from_name: 'Alice', snippet: 'Only message' }],
        }),
      }),
    )

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'msg-1', body: 'Only message' }]
    store.openEmailId = 'msg-1'
    await store.fetchMessageBody('msg-1')

    expect(store.openEmailConversation).toEqual([])
  })

  it('messageBodyById reads any cached body, not only the open message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'msg-1', body_html: '<p>Hi</p>', body_text: 'Hi' }),
      }),
    )

    const store = useInboxStore()
    store.openEmailId = 'msg-2'
    expect(store.messageBodyById('msg-1')).toBeNull()

    await store.fetchMessageBody('msg-1')

    expect(store.messageBodyById('msg-1')).toMatchObject({ html: '<p>Hi</p>', text: 'Hi' })
    expect(store.openEmailHtml).toBeNull()
  })

  it("openEmailAttachments exposes the open message's attachments once the body fetch lands", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'msg-1',
          body_html: null,
          body_text: 'See attached',
          attachments: [
            {
              id: 'att-1',
              filename: 'plan.pdf',
              content_type: 'application/pdf',
              size_bytes: 1024,
              downloadable: true,
            },
          ],
        }),
      }),
    )

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'msg-1', body: 'See attached' }]
    store.openEmailId = 'msg-1'
    expect(store.openEmailAttachments).toEqual([])

    await store.fetchMessageBody('msg-1')

    expect(store.openEmailAttachments).toEqual([
      {
        id: 'att-1',
        filename: 'plan.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        downloadable: true,
      },
    ])
  })

  it('requests a signed attachment URL and starts a named browser download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          url: 'https://store.private.blob.vercel-storage.com/file?signed=1&download=1',
          filename: 'plan.pdf',
        }),
      }),
    )
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const store = useInboxStore()

    await expect(
      store.downloadAttachment({ id: 'att-1', filename: 'plan.pdf', downloadable: true }),
    ).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages/attachment?id=att-1`, {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(click).toHaveBeenCalledOnce()
  })

  describe('unsubscribe', () => {
    const EMAIL = { id: 'news-1', sender: 'Daily Bites' }

    function stubUnsubscribeResponse(result) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => result }))
    }

    it('records a one-click unsubscribe against the cached body and marks it done', async () => {
      stubUnsubscribeResponse({ status: 'unsubscribed', method: 'one-click' })
      const store = useInboxStore()
      store.archiveEmail = vi.fn()
      store.messageBodies.set('news-1', { html: null, text: 'hi' })

      await store.unsubscribeEmail(EMAIL)

      expect(store.messageBodies.get('news-1').unsubscribed).toBe(true)
      expect(store.toasts.at(-1).message).toBe('Unsubscribed from Daily Bites.')
      expect(store.archiveEmail).toHaveBeenCalledWith(EMAIL)
      expect(store.unsubscribingId).toBe(null)
    })

    it('sends allow_ai so the server may drive link-only unsubscribe pages', async () => {
      stubUnsubscribeResponse({ status: 'unsubscribed', method: 'ai' })
      const store = useInboxStore()
      store.archiveEmail = vi.fn()

      await store.unsubscribeEmail(EMAIL)

      const [, options] = vi.mocked(fetch).mock.calls[0]
      expect(JSON.parse(options.body)).toEqual({
        id: 'news-1',
        action: 'unsubscribe',
        allow_ai: true,
      })
      expect(store.archiveEmail).toHaveBeenCalledWith(EMAIL)
    })

    it('flags the cached body and does not mark done when the AI attempt fails', async () => {
      stubUnsubscribeResponse({ status: 'ai_failed', method: 'ai', url: 'https://x.example/u' })
      const store = useInboxStore()
      store.archiveEmail = vi.fn()
      store.messageBodies.set('news-1', { html: null, text: 'hi' })

      await store.unsubscribeEmail(EMAIL)

      expect(store.messageBodies.get('news-1').unsubscribeFailed).toBe(true)
      expect(store.toasts.at(-1).message).toBe('AI could not unsubscribe from Daily Bites.')
      expect(store.toasts.at(-1).kind).toBe('error')
      expect(store.archiveEmail).not.toHaveBeenCalled()
      expect(store.unsubscribingId).toBe(null)
    })

    it('opens a safe manual unsubscribe link in a disowned new tab', async () => {
      stubUnsubscribeResponse({ status: 'manual', method: 'link', url: 'https://x.example/u?t=1' })
      const open = vi.fn()
      vi.stubGlobal('open', open)
      const store = useInboxStore()

      await store.unsubscribeEmail(EMAIL)

      expect(open).toHaveBeenCalledWith('https://x.example/u?t=1', '_blank', 'noopener')
    })

    // Defence in depth: the URL ultimately comes from a sender-controlled
    // List-Unsubscribe header, so the client re-applies the same policy the
    // API uses rather than navigating to whatever it is handed.
    it.each([
      ['javascript:', 'javascript:alert(1)'],
      ['plain http', 'http://x.example/u'],
      ['credentials in the authority', 'https://user:pw@x.example/u'],
      ['a private host', 'https://intranet.internal/u'],
    ])('refuses to open a manual link with %s', async (_label, url) => {
      stubUnsubscribeResponse({ status: 'manual', method: 'link', url })
      const open = vi.fn()
      vi.stubGlobal('open', open)
      const store = useInboxStore()

      await store.unsubscribeEmail(EMAIL)

      expect(open).not.toHaveBeenCalled()
      expect(store.toasts.at(-1).message).toBe('This sender offers no automated unsubscribe.')
    })

    it('ignores a manual fallback whose mailto is not actually a mailto URI', async () => {
      stubUnsubscribeResponse({ status: 'manual', method: 'mailto', mailto: 'javascript:alert(1)' })
      const store = useInboxStore()

      await store.unsubscribeEmail(EMAIL)

      expect(store.toasts.at(-1).message).toBe('This sender offers no automated unsubscribe.')
    })

    it('notifies and clears the in-flight id when the request fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = useInboxStore()

      await store.unsubscribeEmail(EMAIL)

      expect(store.toasts.at(-1).message).toBe('Failed to unsubscribe. Please try again.')
      expect(store.unsubscribingId).toBe(null)
    })

    it('ignores a second request while one is already in flight', async () => {
      stubUnsubscribeResponse({ status: 'unsubscribed' })
      const store = useInboxStore()
      store.unsubscribingId = 'news-1'

      await store.unsubscribeEmail(EMAIL)

      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('fetchMessageBody returns null and does not cache on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useInboxStore()
    const body = await store.fetchMessageBody('deadbeef-0000-0000-0000-000000000000')

    expect(body).toBe(null)
    expect(store.messageBodies.has('deadbeef-0000-0000-0000-000000000000')).toBe(false)
  })

  it('fetchMessageBody flags the open body as loading during the fetch and clears it after', async () => {
    let resolveFetch
    const pending = new Promise((resolve) => {
      resolveFetch = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'msg-1' }]
    store.openEmailId = 'msg-1'

    const promise = store.fetchMessageBody('msg-1')
    // In flight: the getter reports the open email's body as loading.
    expect(store.bodyLoadingId).toBe('msg-1')
    expect(store.isOpenBodyLoading).toBe(true)

    resolveFetch({ ok: true, json: async () => ({ body_html: '<p>hi</p>', body_text: 'hi' }) })
    await promise

    // Settled: loading cleared whether it resolved or rejected.
    expect(store.bodyLoadingId).toBe(null)
    expect(store.isOpenBodyLoading).toBe(false)
  })

  it('fetchMessageBody clears the loading flag when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = useInboxStore()
    store.openEmailId = 'boom'
    await store.fetchMessageBody('boom')

    expect(store.bodyLoadingId).toBe(null)
    expect(store.isOpenBodyLoading).toBe(false)
  })

  it('fetchMessageBody does not flag loading on a cache hit', async () => {
    const store = useInboxStore()
    store.messageBodies.set('cached', { html: '<p>x</p>', text: 'x' })
    store.openEmailId = 'cached'

    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)

    const body = await store.fetchMessageBody('cached')
    expect(body).toEqual({ html: '<p>x</p>', text: 'x' })
    expect(spy).not.toHaveBeenCalled()
    // A cache hit must never spin — bodyLoadingId stays null throughout.
    expect(store.bodyLoadingId).toBe(null)
    expect(store.isOpenBodyLoading).toBe(false)
  })

  it('holds an HTML-body reveal open for a minimum duration so the spinner is perceivable', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ body_html: '<p>hi</p>', body_text: 'hi' }),
        }),
      )
      const store = useInboxStore()
      store.traditionalEmails = [{ id: 'msg-1', hasHtml: true }]
      store.openEmailId = 'msg-1'

      const promise = store.fetchMessageBody('msg-1')
      // The mocked fetch/json resolve instantly, but the reveal must still be
      // held back — otherwise a fast response never shows the spinner at all.
      await vi.advanceTimersByTimeAsync(0)
      expect(store.messageBodies.has('msg-1')).toBe(false)
      expect(store.isOpenBodyLoading).toBe(true)

      await vi.advanceTimersByTimeAsync(200)
      await promise

      expect(store.messageBodies.get('msg-1')).toMatchObject({ html: '<p>hi</p>' })
      expect(store.isOpenBodyLoading).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not delay revealing a text-only body, since it never shows a spinner', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ body_html: null, body_text: 'plain only' }),
        }),
      )
      const store = useInboxStore()
      store.traditionalEmails = [{ id: 'msg-2', hasHtml: false }]
      store.openEmailId = 'msg-2'

      const promise = store.fetchMessageBody('msg-2')
      await vi.advanceTimersByTimeAsync(0)

      expect(store.messageBodies.has('msg-2')).toBe(true)
      await promise
    } finally {
      vi.useRealTimers()
    }
  })

  it('openReader triggers an on-demand body fetch for the opened email', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-9', body_html: '<b>hi</b>', body_text: 'hi' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useInboxStore()
    const email = { id: 'msg-9', unread: false }
    store.traditionalEmails = [email]

    store.openReader(email)
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages?id=msg-9`, {
        headers: { Authorization: 'Bearer test-access-token' },
      }),
    )
    await vi.waitFor(() => expect(store.openEmailHtml).toBe('<b>hi</b>'))
  })

  it('scheduleEmail offers Undo that restores the inbox message and due time', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { scheduled_for: '2026-07-15T07:00:00.000Z' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    const email = { id: 'msg-1', unread: true, scheduledFor: null }
    store.traditionalEmails = [email]
    store.unreadInboxCount = 1
    store.openEmailId = email.id

    const success = await store.scheduleEmail(email, '2026-07-15T07:00:00.000Z', 'Tomorrow')

    expect(success).toBe(true)
    expect(store.traditionalEmails).toEqual([])
    expect(store.unreadInboxCount).toBe(0)
    expect(store.openEmailId).toBe(null)
    expect(fetchMock).toHaveBeenCalledWith(`${MESSAGES_API_URL}/messages`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'msg-1', scheduled_for: '2026-07-15T07:00:00.000Z' }),
    })
    expect(store.toasts.at(-1).message).toBe('Scheduled for Tomorrow.')
    expect(store.toasts.at(-1).action.label).toBe('Undo')

    await store.runToastAction(store.toasts.at(-1).id)

    expect(store.traditionalEmails).toEqual([email])
    expect(store.unreadInboxCount).toBe(1)
    expect(email.scheduledFor).toBe(null)
    expect(fetchMock).toHaveBeenLastCalledWith(`${MESSAGES_API_URL}/messages`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'msg-1', scheduled_for: null }),
    })
  })

  it('scheduleEmail restores the message and unread count when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useInboxStore()
    const email = { id: 'msg-1', unread: true, scheduledFor: null }
    store.traditionalEmails = [email]
    store.unreadInboxCount = 1

    const success = await store.scheduleEmail(email, '2026-07-15T07:00:00.000Z', 'Tomorrow')

    expect(success).toBe(false)
    expect(store.traditionalEmails).toEqual([email])
    expect(email.scheduledFor).toBe(null)
    expect(store.unreadInboxCount).toBe(1)
    expect(store.toasts.at(-1)).toMatchObject({
      message: 'Failed to schedule email.',
      kind: 'error',
    })
  })

  describe('rebuildDigest', () => {
    it('asks the API to rebuild and reports success', async () => {
      const store = useInboxStore()
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      vi.stubGlobal('fetch', fetchMock)

      await expect(store.rebuildDigest()).resolves.toBe(true)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${TASKS_API_URL}/tasks/refresh`)
      expect(init.method).toBe('POST')
    })

    // 501 means this deployment has no enricher wired up: a permanent state
    // the caller handles by falling back, not an error to surface.
    it('resolves false when refresh is not configured', async () => {
      const store = useInboxStore()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 501 }))

      await expect(store.rebuildDigest()).resolves.toBe(false)
    })

    it('throws on a real failure', async () => {
      const store = useInboxStore()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))

      await expect(store.rebuildDigest()).rejects.toThrow('502')
    })
  })

  describe('markTopicRead', () => {
    const topic = () => ({
      title: 'Kitchen',
      items: [
        { message_id: 'msg-1', unread: true },
        { message_id: 'msg-2', unread: false },
        { message_id: 'msg-3', unread: true },
      ],
    })

    it('marks only the unread messages, clearing dots, rows and the badge', async () => {
      const store = useInboxStore()
      store.traditionalEmails = [{ id: 'msg-1', unread: true }]
      store.unreadInboxCount = 5
      const updateMessage = vi.spyOn(store, 'updateMessage').mockResolvedValue({ ok: true })

      const subject = topic()
      await expect(store.markTopicRead(subject)).resolves.toBe(2)

      // The already-read message is left alone.
      expect(updateMessage.mock.calls.map(([id]) => id)).toEqual(['msg-1', 'msg-3'])
      expect(updateMessage).toHaveBeenCalledWith('msg-1', { is_unread: false })
      expect(subject.items.map((i) => i.unread)).toEqual([false, false, false])
      expect(store.traditionalEmails[0].unread).toBe(false)
      expect(store.unreadInboxCount).toBe(3)
    })

    it('keeps the dot and the count for a message that failed to update', async () => {
      const store = useInboxStore()
      store.unreadInboxCount = 5
      vi.spyOn(store, 'updateMessage').mockImplementation(async (id) => {
        if (id === 'msg-3') throw new Error('boom')
        return { ok: true }
      })

      const subject = topic()
      await expect(store.markTopicRead(subject)).resolves.toBe(1)

      expect(subject.items.map((i) => i.unread)).toEqual([false, false, true])
      expect(store.unreadInboxCount).toBe(4)
    })

    it('does nothing when the topic has nothing unread', async () => {
      const store = useInboxStore()
      const updateMessage = vi.spyOn(store, 'updateMessage')
      await expect(
        store.markTopicRead({ items: [{ message_id: 'msg-1', unread: false }] }),
      ).resolves.toBe(0)
      expect(updateMessage).not.toHaveBeenCalled()
    })
  })

  describe('markTopicItemRead', () => {
    it('marks an unread item read, clearing its dot, row and the badge', async () => {
      const store = useInboxStore()
      store.traditionalEmails = [{ id: 'msg-1', unread: true }]
      store.unreadInboxCount = 5
      const updateMessage = vi.spyOn(store, 'updateMessage').mockResolvedValue({ ok: true })

      const item = { message_id: 'msg-1', unread: true }
      await store.markTopicItemRead(item)

      expect(updateMessage).toHaveBeenCalledWith('msg-1', { is_unread: false })
      expect(item.unread).toBe(false)
      expect(store.traditionalEmails[0].unread).toBe(false)
      expect(store.unreadInboxCount).toBe(4)
    })

    it('does nothing for an item that is already read', async () => {
      const store = useInboxStore()
      const updateMessage = vi.spyOn(store, 'updateMessage')
      await store.markTopicItemRead({ message_id: 'msg-1', unread: false })
      expect(updateMessage).not.toHaveBeenCalled()
    })

    it('leaves the dot and the count when the update fails, and rejects', async () => {
      const store = useInboxStore()
      store.unreadInboxCount = 5
      vi.spyOn(store, 'updateMessage').mockRejectedValue(new Error('boom'))

      const item = { message_id: 'msg-1', unread: true }
      await expect(store.markTopicItemRead(item)).rejects.toThrow('boom')

      expect(item.unread).toBe(true)
      expect(store.unreadInboxCount).toBe(5)
    })
  })

  describe('rescheduleDigestItem', () => {
    it('delegates to updateMessage with the new scheduled_for', async () => {
      const store = useInboxStore()
      const updateMessage = vi.spyOn(store, 'updateMessage').mockResolvedValue({ ok: true })

      const item = { message_id: 'msg-1' }
      await store.rescheduleDigestItem(item, '2026-08-25T08:00:00.000Z')

      expect(updateMessage).toHaveBeenCalledWith('msg-1', {
        scheduled_for: '2026-08-25T08:00:00.000Z',
      })
    })

    it('rejects when the update fails', async () => {
      const store = useInboxStore()
      vi.spyOn(store, 'updateMessage').mockRejectedValue(new Error('boom'))

      await expect(
        store.rescheduleDigestItem({ message_id: 'msg-1' }, '2026-08-25T08:00:00.000Z'),
      ).rejects.toThrow('boom')
    })
  })
})

describe('finding an email by id', () => {
  it('looks across every list the reader can open from', () => {
    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'a', subject: 'Inbox one' }]
    store.doneEmails = [{ id: 'b', subject: 'Archived one' }]
    store.sentEmails = [{ id: 'c', subject: 'Sent one' }]

    expect(store.emailById('a')).toMatchObject({ subject: 'Inbox one' })
    expect(store.emailById('b')).toMatchObject({ subject: 'Archived one' })
    expect(store.emailById('c')).toMatchObject({ subject: 'Sent one' })
    expect(store.emailById('missing')).toBeNull()
  })

  it('returns null for an empty id rather than the first email', () => {
    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'a', subject: 'Inbox one' }]

    expect(store.emailById('')).toBeNull()
    expect(store.emailById(null)).toBeNull()
  })

  it('still resolves the open email through the same lookup', () => {
    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'a', subject: 'Inbox one' }]
    store.openEmailId = 'a'

    expect(store.openEmail).toMatchObject({ subject: 'Inbox one' })
  })
})
