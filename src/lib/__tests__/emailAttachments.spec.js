import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuth0Client } from '../../auth0-client'
import { MESSAGES_API_URL } from '../apiWorkers'
import {
  attachmentEmailRow,
  attachmentSummary,
  correspondentLabel,
  fetchEmailAttachments,
  groupAttachmentsByMonth,
} from '../emailAttachments'

const LIST_URL = `${MESSAGES_API_URL}/messages/attachments`

function attachment(overrides = {}) {
  return {
    id: 'attachment-1',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    downloadable: true,
    embedded: false,
    direction: 'received',
    messageId: 'message-1',
    subject: 'Your invoice',
    correspondent: { name: 'Northwind Billing', address: 'billing@northwind.example', others: 0 },
    date: '2026-11-20T08:00:00.000Z',
    unread: true,
    starred: false,
    archived: true,
    ...overrides,
  }
}

beforeEach(() => {
  setAuth0Client(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchEmailAttachments', () => {
  function stubList(payload) {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('asks for both directions without a query', async () => {
    const fetchMock = stubList({ attachments: [attachment()], nextCursor: 'cursor-1' })

    expect(await fetchEmailAttachments({ direction: 'all' })).toEqual({
      attachments: [attachment()],
      nextCursor: 'cursor-1',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(LIST_URL)
  })

  it('names the direction, the embedded pictures and the page it wants', async () => {
    const fetchMock = stubList({ attachments: [], nextCursor: null })

    await fetchEmailAttachments({ direction: 'sent', embedded: true, before: 'a|b' })

    expect(fetchMock.mock.calls[0][0]).toBe(`${LIST_URL}?direction=sent&embedded=1&before=a%7Cb`)
  })

  it('reads a response without a list as an empty last page', async () => {
    stubList({})

    expect(await fetchEmailAttachments()).toEqual({ attachments: [], nextCursor: null })
  })
})

describe('groupAttachmentsByMonth', () => {
  it('puts neighbouring files of one month under one heading, in the order given', () => {
    const groups = groupAttachmentsByMonth([
      attachment({ id: 'a', date: '2026-11-20T08:00:00.000Z' }),
      attachment({ id: 'b', date: '2026-11-02T08:00:00.000Z' }),
      attachment({ id: 'c', date: '2026-10-15T08:00:00.000Z' }),
      attachment({ id: 'd', date: '2025-11-15T08:00:00.000Z' }),
    ])

    expect(
      groups.map((group) => [group.label, group.attachments.map((entry) => entry.id)]),
    ).toEqual([
      ['November 2026', ['a', 'b']],
      ['October 2026', ['c']],
      ['November 2025', ['d']],
    ])
  })

  it('files an attachment without a usable date under Undated', () => {
    const groups = groupAttachmentsByMonth([attachment({ date: null }), attachment({ date: 'x' })])

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Undated')
    expect(groups[0].attachments).toHaveLength(2)
  })
})

describe('correspondentLabel', () => {
  it('says who a received file came from', () => {
    expect(correspondentLabel(attachment())).toBe('From Northwind Billing')
  })

  it('falls back to the address and counts the other recipients of a sent file', () => {
    const sent = (others) =>
      attachment({
        direction: 'sent',
        correspondent: { name: null, address: 'sam@example.com', others },
      })

    expect(correspondentLabel(sent(0))).toBe('To sam@example.com')
    expect(correspondentLabel(sent(1))).toBe('To sam@example.com and 1 other')
    expect(correspondentLabel(sent(3))).toBe('To sam@example.com and 3 others')
  })

  it('is empty when the mail names nobody', () => {
    expect(correspondentLabel(attachment({ correspondent: null }))).toBe('')
  })
})

describe('attachmentSummary', () => {
  it('joins the correspondent and the subject of the email', () => {
    expect(attachmentSummary(attachment())).toBe('From Northwind Billing · Your invoice')
  })

  it('stands in for a missing subject and leaves out a missing correspondent', () => {
    expect(attachmentSummary(attachment({ subject: null }))).toBe(
      'From Northwind Billing · (no subject)',
    )
    expect(attachmentSummary(attachment({ subject: '', correspondent: null }))).toBe('(no subject)')
  })
})

describe('attachmentEmailRow', () => {
  it('describes a received email the way the inbox list does', () => {
    expect(attachmentEmailRow(attachment())).toEqual({
      id: 'message-1',
      from_name: 'Northwind Billing',
      from_address: 'billing@northwind.example',
      recipients: { to: [] },
      subject: 'Your invoice',
      sent_at: '2026-11-20T08:00:00.000Z',
      is_sent: false,
      is_unread: true,
      is_starred: false,
      is_archived: true,
      has_html: true,
      has_attachments: true,
    })
  })

  it('puts the correspondent of a sent email on the To line', () => {
    const row = attachmentEmailRow(
      attachment({
        direction: 'sent',
        correspondent: { name: 'Sam Carter', address: 'sam@example.com', others: 2 },
      }),
    )

    expect(row.is_sent).toBe(true)
    expect(row.from_address).toBeNull()
    expect(row.recipients).toEqual({ to: [{ name: 'Sam Carter', address: 'sam@example.com' }] })
  })
})
