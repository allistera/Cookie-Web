import { describe, expect, it } from 'vitest'

import { storeEmail } from '../src/store.js'
import { createMockSql } from './helpers.js'

const OWNER = 'owner@example.com'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function makeRecord(overrides = {}) {
  return {
    messageId: '<simple-001@example.com>',
    subject: 'Simple test message',
    fromName: 'Ada Lovelace',
    fromAddress: 'ada@example.com',
    recipients: { to: [{ name: null, address: 'inbox@example.org' }], cc: [], bcc: [] },
    snippet: 'Hello from the simple fixture.',
    bodyText: 'Hello from the simple fixture.',
    bodyHtml: null,
    truncated: false,
    references: [],
    headers: [{ key: 'subject', value: 'Simple test message' }],
    attachments: [],
    rawSize: 321,
    envelopeFrom: 'sender@example.com',
    envelopeTo: 'inbox@example.org',
    sentAt: new Date('2026-07-07T10:00:00.000Z'),
    ...overrides,
  }
}

describe('storeEmail', () => {
  it('inserts a new thread + message and returns inserted', async () => {
    const { sql, transactions } = createMockSql({
      lookupRows: [{ user_id: USER_ID, is_duplicate: false, thread_id: null }],
    })

    const result = await storeEmail(sql, makeRecord(), OWNER)

    expect(result).toBe('inserted')
    expect(transactions).toHaveLength(1)
    const texts = transactions[0].map((q) => q.text)
    expect(texts.some((t) => t.includes('INSERT INTO threads'))).toBe(true)
    expect(texts.some((t) => t.includes('INSERT INTO messages'))).toBe(true)
    expect(texts.some((t) => t.includes('UPDATE threads'))).toBe(false)

    const messageInsert = transactions[0].find((q) => q.text.includes('INSERT INTO messages'))
    expect(messageInsert.text).toContain('ON CONFLICT (user_id, message_id)')
    expect(messageInsert.values).toContain('<simple-001@example.com>')
    expect(messageInsert.values).toContain(USER_ID)
  })

  it('returns duplicate without writing anything', async () => {
    const { sql, transactions } = createMockSql({
      lookupRows: [{ user_id: USER_ID, is_duplicate: true, thread_id: null }],
    })

    const result = await storeEmail(sql, makeRecord(), OWNER)

    expect(result).toBe('duplicate')
    expect(transactions).toHaveLength(0)
  })

  it('reuses a referenced thread and bumps its counters', async () => {
    const threadId = '22222222-2222-4222-8222-222222222222'
    const { sql, transactions } = createMockSql({
      lookupRows: [{ user_id: USER_ID, is_duplicate: false, thread_id: threadId }],
    })

    const result = await storeEmail(
      sql,
      makeRecord({ references: ['<original@example.com>'] }),
      OWNER,
    )

    expect(result).toBe('inserted')
    const texts = transactions[0].map((q) => q.text)
    expect(texts.some((t) => t.includes('INSERT INTO threads'))).toBe(false)
    const update = transactions[0].find((q) => q.text.includes('UPDATE threads'))
    expect(update).toBeDefined()
    expect(update.text).toContain('message_count = message_count + 1')
    expect(update.values).toContain(threadId)
  })

  it('throws when no users row matches OWNER_EMAIL', async () => {
    const { sql, transactions } = createMockSql({ lookupRows: [] })

    await expect(storeEmail(sql, makeRecord(), OWNER)).rejects.toThrow(/OWNER_EMAIL/)
    expect(transactions).toHaveLength(0)
  })

  it('stores attachment metadata rows with null blob_url', async () => {
    const { sql, transactions } = createMockSql({
      lookupRows: [{ user_id: USER_ID, is_duplicate: false, thread_id: null }],
    })

    await storeEmail(
      sql,
      makeRecord({ attachments: [{ filename: 'notes.txt', mime_type: 'text/plain', size: 24 }] }),
      OWNER,
    )

    const attachmentInsert = transactions[0].find((q) => q.text.includes('INSERT INTO attachments'))
    expect(attachmentInsert).toBeDefined()
    expect(attachmentInsert.values).toContain('notes.txt')
    expect(attachmentInsert.values).toContain(null)
  })

  it('propagates transaction failures', async () => {
    const { sql } = createMockSql({
      lookupRows: [{ user_id: USER_ID, is_duplicate: false, thread_id: null }],
    })
    sql.transaction = () => Promise.reject(new Error('connection refused'))

    await expect(storeEmail(sql, makeRecord(), OWNER)).rejects.toThrow('connection refused')
  })
})
