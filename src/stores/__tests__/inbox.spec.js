import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useInboxStore } from '../inbox'

vi.mock('../../auth0-client', () => ({
  getAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') }),
}))

describe('Inbox Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
              body_text: 'Hi Allister, following up on our call.\n\nThe revised plan is attached.',
              sent_at: sentAt.toISOString(),
              is_unread: true,
              is_starred: false,
              has_ai_summary: true,
            },
          ],
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadEmails()

    expect(fetch).toHaveBeenCalledWith('/api/emails?limit=50', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.traditionalEmails).toEqual([
      {
        id: 'abc-123',
        sender: 'City Construction',
        address: 'updates@cityconstruction.com',
        isSent: false,
        to: null,
        subject: 'Revised Floor Plan',
        snippet: 'Hi Allister, following up...',
        body: 'Hi Allister, following up on our call.\n\nThe revised plan is attached.',
        sentAt: sentAt.toISOString(),
        date: '10:04 am',
        unread: true,
        starred: false,
        scheduledFor: null,
        readAt: null,
        readCount: 0,
        hasHtml: false,
        hasAiSummary: true,
        hasAttachments: false,
        labels: [],
      },
    ])
    expect(store.unreadInboxCount).toBe(1)
    expect(store.isRefreshing).toBe(false)
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
      '/api/emails?limit=50&before=2026-07-01T00%3A00%3A00Z%7C11111111-1111-1111-1111-111111111111',
      { headers: { Authorization: 'Bearer test-access-token' } },
    )
    expect(store.traditionalEmails.map((e) => e.id)).toEqual(['a', 'b'])
    expect(store.hasMoreEmails).toBe(false)

    // No cursor left: loadMoreEmails is a no-op.
    await store.loadMoreEmails()
    expect(fetch).toHaveBeenCalledTimes(2)
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
                cc: [],
                bcc: [],
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

    expect(fetch).toHaveBeenCalledWith('/api/emails?folder=sent&limit=50', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.sentEmails).toHaveLength(1)
    expect(store.sentEmails[0].to).toBe('info@citytileandstone.com')
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
      '/api/emails?folder=sent&limit=50&before=2026-07-01T00%3A00%3A00Z%7C11111111-1111-1111-1111-111111111111',
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
            receipts: [
              { message_id: row.id, first_opened_at: openedAt, open_count: 2 },
            ],
          }),
        }),
    )

    const store = useInboxStore()
    await store.loadSentEmails()

    expect(fetch).toHaveBeenLastCalledWith(
      `/api/read-receipts?messageIds=${row.id}`,
      { headers: { Authorization: 'Bearer test-access-token' } },
    )
    expect(store.sentEmails[0]).toMatchObject({ readAt: openedAt, readCount: 2 })
  })

  it('loads spam from its isolated server-backed folder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          emails: [{
            id: 'spam-1', from_name: 'Spammer', from_address: 'spam@example.com',
            subject: 'Guaranteed prize', snippet: 'Act now', body_text: 'Act now',
            sent_at: new Date().toISOString(), is_unread: true, is_starred: false,
          }],
          nextCursor: null,
        }),
      }),
    )

    const store = useInboxStore()
    await store.loadSpamEmails()

    expect(fetch).toHaveBeenCalledWith('/api/emails?folder=spam&limit=50', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.spamEmails.map((email) => email.id)).toEqual(['spam-1'])
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

      expect(fetch).toHaveBeenCalledWith('/api/emails?folder=done&limit=100', {
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
        `/api/emails?folder=done&limit=100&before=${expectedCursor}`,
        { headers: { Authorization: 'Bearer test-access-token' } },
      )
      expect(store.donePageIndex).toBe(1)
      expect(store.doneEmails.map((email) => email.id)).toEqual(['b1', 'b2'])
      expect(store.doneHasNext).toBe(false)

      await store.prevDonePage()
      expect(fetch).toHaveBeenLastCalledWith('/api/emails?folder=done&limit=100', {
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
        json: async () => ({ draft: { subject: 'Hello', text: 'Generated body' } }),
      }),
    )
    const store = useInboxStore()
    store.composerTo = 'person@example.com'
    store.composerAiInstruction = 'Confirm Tuesday works.'

    await store.requestAiDraft()

    expect(fetch).toHaveBeenCalledWith('/api/compose', {
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
    expect(store.aiDraftPreview).toBe('Generated body')
    expect(store.composerSubject).toBe('Hello')
    expect(store.composerTextArea).toBe('')

    store.insertAiDraft()
    expect(store.composerTextArea).toBe('Generated body')
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

    expect(fetch).toHaveBeenCalledWith('/api/compose', {
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
    expect(fetchMock).toHaveBeenCalledWith('/api/messages', {
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
      '/api/messages',
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

    expect(fetch).toHaveBeenCalledWith('/api/summarize', {
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
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) })

    await store.sendMail({ to: 'someone@example.com', subject: 'S', text: 'T' })
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/emails?folder=sent&limit=50',
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
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messages?resource=contacts')
  })

  it('setSignature persists the signature and openComposer prefills a fresh draft with it', () => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }))
    const store = useInboxStore()

    store.setSignature('<p>Best, <strong>Allister</strong></p>')
    expect(store.signatureHtml).toBe('<p>Best, <strong>Allister</strong></p>')
    expect(localStorage.getItem('cookie-signature-html')).toBe('<p>Best, <strong>Allister</strong></p>')

    store.openComposer()
    expect(store.composerHtml).toContain('<p>Best, <strong>Allister</strong></p>')
    expect(store.composerTextArea).toContain('Best, Allister')
  })

  it('openComposer does not overwrite an in-progress draft with the signature', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }))
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
      expect(fetchMock).toHaveBeenCalledWith('/api/messages?resource=contacts', expect.anything()),
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
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tasks')
  })

  it('completeTask posts the completion and drops the task from the list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.tasks = [
      { id: 't1', source: 'todoist', content: 'Renew insurance' },
      { id: 't2', source: 'todoist', content: 'Book dentist' },
    ]

    await store.completeTask('t1')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tasks')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ id: 't1', action: 'complete' })
    expect(store.tasks.map((t) => t.id)).toEqual(['t2'])
  })

  it('completeTask throws and keeps the task when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 })
    vi.stubGlobal('fetch', fetchMock)
    const store = useInboxStore()
    store.tasks = [{ id: 't1', source: 'todoist', content: 'Renew insurance' }]

    await expect(store.completeTask('t1')).rejects.toThrow('502')
    expect(store.tasks.map((t) => t.id)).toEqual(['t1'])
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

    it('undo cancels the send and restores the message in the composer', async () => {
      const fetchMock = stubSendOk()
      const store = useInboxStore()
      armComposer(store)

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
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
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
      })
      expect(store.toasts.at(-1)?.message).toBe('Email scheduled for Tomorrow.')
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
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
      vi.stubGlobal('fetch', fetchMock)
      const store = useInboxStore()
      armComposer(store)

      const result = await store.sendEmailLater('2026-08-02T09:00:00.000Z', 'Tomorrow')

      expect(result).toBe(false)
      expect(store.isComposerActive).toBe(true)
      expect(store.composerTo).toBe('someone@example.com')
      expect(store.toasts.at(-1)?.message).toMatch(/failed/i)
    })

    it('loads the pending scheduled-send queue once and caches it', async () => {
      const scheduledSends = [{ id: 'sched-1', subject: 'Hello', scheduledFor: '2026-08-02T09:00:00.000Z' }]
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ scheduledSends }) })
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

  it('askGemini posts to /api/ask and records the answer with sources', async () => {
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
    await store.askGemini('What happened with the renovation?')

    expect(fetch).toHaveBeenCalledWith('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ question: 'What happened with the renovation?' }),
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

  it('askGemini records an apology message when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))

    const store = useInboxStore()
    await store.askGemini('Anything?')

    expect(store.chatHistory[1].text).toContain("couldn't reach the assistant")
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

    expect(fetch).toHaveBeenCalledWith('/api/search?q=zoom%20invoice', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.activeSearchQuery).toBe('zoom invoice')
    expect(store.traditionalEmails).toHaveLength(1)
    expect(store.traditionalEmails[0].subject).toBe('Invoice for subscription renewal')
    expect(store.isRefreshing).toBe(false)
  })

  it('notifies and keeps the list when search fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'keep-me' }]
    await store.searchEmails('anything')

    expect(store.traditionalEmails).toEqual([{ id: 'keep-me' }])
    expect(store.activeSearchQuery).toBe('')
    expect(store.toasts[0]).toMatchObject({ kind: 'error' })
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
    await store.searchEmails('new query')
    expect(store.traditionalEmails[0].subject).toBe('Newer result')

    // The stale response arrives late — it must not clobber the newer results.
    resolveFirst({ ok: true, json: async () => ({ emails: [emailRow('old-1', 'Stale result')] }) })
    await first

    expect(store.traditionalEmails[0].subject).toBe('Newer result')
    expect(store.activeSearchQuery).toBe('new query')
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
    expect(fetch).toHaveBeenCalledWith('/api/emails?limit=50', {
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

    await expect(store.renameLabel(label, '  Money  ')).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledWith('/api/labels', {
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: [rule] }) }))

    const store = useInboxStore()
    await store.loadRules()

    expect(fetch).toHaveBeenCalledWith('/api/labels?resource=rules', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(store.rules).toEqual([rule])
  })

  it('creates a tag rule', async () => {
    const rule = {
      id: 'rule-1', name: 'Bills', label_id: 'label-1', match_type: 'all', enabled: true,
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

    expect(fetch).toHaveBeenCalledWith('/api/labels?resource=rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-access-token' },
      body: JSON.stringify(payload),
    })
    expect(store.rules).toEqual([rule])
    expect(store.toasts.at(-1)?.message).toBe('Rule created.')
  })

  it('returns null and notifies when creating a rule fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const store = useInboxStore()
    await expect(store.createRule({ label_id: 'label-1', conditions: [] })).resolves.toBeNull()
    expect(store.toasts.at(-1)?.message).toBe('Failed to create rule.')
  })

  it('updates a rule and rolls back on failure', async () => {
    const rule = { id: 'rule-1', name: 'Bills', enabled: true }
    const store = useInboxStore()
    store.rules = [rule]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(store.updateRule(rule, { enabled: false })).resolves.toBe(false)
    expect(rule.enabled).toBe(true)
    expect(store.toasts.at(-1)?.message).toBe('Failed to update rule.')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rule: { ...rule, enabled: false } }) }),
    )
    await expect(store.updateRule(rule, { enabled: false })).resolves.toBe(true)
    expect(rule.enabled).toBe(false)
    expect(fetch).toHaveBeenCalledWith('/api/labels?resource=rules', {
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

    expect(fetch).toHaveBeenCalledWith('/api/labels?resource=rules', {
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
    })

    expect(fetch).toHaveBeenCalledWith('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ to: 'someone@example.com', subject: 'Re: Hello', text: 'Hi there' }),
    })
    expect(result).toEqual({ id: 'msg-1' })
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

    expect(fetch).toHaveBeenCalledWith('/api/messages', {
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
      expect(fetch).toHaveBeenCalledWith('/api/messages', {
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
    expect(fetch).toHaveBeenLastCalledWith('/api/messages', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-access-token',
      },
      body: JSON.stringify({ id: 'abc-123', is_archived: false, is_unread: true }),
    })
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
    expect(fetch).toHaveBeenLastCalledWith('/api/messages', {
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

    expect(body).toEqual({ html: '<p>Hello</p>', text: 'Hello', unsubscribe: null, thread: [], attachments: [] })
    store.traditionalEmails = [{ id: '11111111-1111-1111-1111-111111111111' }]
    store.openEmailId = '11111111-1111-1111-1111-111111111111'
    expect(store.openEmailSummary).toBe('The saved project update.')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/messages?id=11111111-1111-1111-1111-111111111111',
      { headers: { Authorization: 'Bearer test-access-token' } },
    )

    // Second call for the same id is served from cache — no second request.
    const again = await store.fetchMessageBody('11111111-1111-1111-1111-111111111111')
    expect(again).toEqual({ html: '<p>Hello</p>', text: 'Hello', unsubscribe: null, thread: [], attachments: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
  })

  it('openEmailThread exposes the conversation history, excluding the open message itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'msg-2',
          body_html: null,
          body_text: 'Latest reply',
          thread: [
            { id: 'msg-1', from_name: 'Alice', snippet: 'First message', sent_at: '2026-01-01T00:00:00Z' },
            { id: 'msg-2', from_name: 'Bob', snippet: 'Latest reply', sent_at: '2026-01-02T00:00:00Z' },
          ],
        }),
      }),
    )

    const store = useInboxStore()
    store.traditionalEmails = [{ id: 'msg-2', body: 'Latest reply' }]
    store.openEmailId = 'msg-2'
    await store.fetchMessageBody('msg-2')

    expect(store.openEmailThread).toEqual([
      { id: 'msg-1', from_name: 'Alice', snippet: 'First message', sent_at: '2026-01-01T00:00:00Z' },
    ])
  })

  it('openEmailThread is empty before the body fetch resolves or when there is no thread', () => {
    const store = useInboxStore()
    expect(store.openEmailThread).toEqual([])
  })

  it('openEmailAttachments exposes the open message\'s attachments once the body fetch lands', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'msg-1',
          body_html: null,
          body_text: 'See attached',
          attachments: [
            { id: 'att-1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 1024, downloadable: true },
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
      { id: 'att-1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 1024, downloadable: true },
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

    expect(fetch).toHaveBeenCalledWith('/api/messages?resource=attachment&id=att-1', {
      headers: { Authorization: 'Bearer test-access-token' },
    })
    expect(click).toHaveBeenCalledOnce()
  })

  describe('unsubscribe', () => {
    const EMAIL = { id: 'news-1', sender: 'Daily Bites' }

    function stubUnsubscribeResponse(result) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => result }))
    }

    it('records a one-click unsubscribe against the cached body', async () => {
      stubUnsubscribeResponse({ status: 'unsubscribed', method: 'one-click' })
      const store = useInboxStore()
      store.messageBodies.set('news-1', { html: null, text: 'hi' })

      await store.unsubscribeEmail(EMAIL)

      expect(store.messageBodies.get('news-1').unsubscribed).toBe(true)
      expect(store.toasts.at(-1).message).toBe('Unsubscribed from Daily Bites.')
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
      expect(fetchMock).toHaveBeenCalledWith('/api/messages?id=msg-9', {
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
    expect(fetchMock).toHaveBeenCalledWith('/api/messages', {
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
    expect(fetchMock).toHaveBeenLastCalledWith('/api/messages', {
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
    expect(store.toasts.at(-1)).toMatchObject({ message: 'Failed to schedule email.', kind: 'error' })
  })

  describe('rebuildDigest', () => {
    it('asks the API to rebuild and reports success', async () => {
      const store = useInboxStore()
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      vi.stubGlobal('fetch', fetchMock)

      await expect(store.rebuildDigest()).resolves.toBe(true)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/tasks?resource=refresh')
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
      await expect(store.markTopicRead({ items: [{ message_id: 'msg-1', unread: false }] })).resolves.toBe(0)
      expect(updateMessage).not.toHaveBeenCalled()
    })
  })

})
