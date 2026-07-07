import { describe, expect, it } from 'vitest'

import { htmlToText, parseEmail } from '../src/parse.js'
import { fakeMessage, readFixture } from './helpers.js'

describe('parseEmail', () => {
  it('parses the simple fixture into a normalized record', async () => {
    const record = await parseEmail(fakeMessage(readFixture('simple.eml')))

    expect(record.messageId).toBe('<simple-001@example.com>')
    expect(record.subject).toBe('Simple test message')
    expect(record.fromName).toBe('Ada Lovelace')
    expect(record.fromAddress).toBe('ada@example.com')
    expect(record.recipients.to).toEqual([{ name: null, address: 'inbox@example.org' }])
    expect(record.bodyText).toContain('Hello from the simple fixture.')
    expect(record.snippet).toMatch(/^Hello from the simple fixture\./)
    expect(record.snippet.length).toBeLessThanOrEqual(103)
    expect(record.truncated).toBe(false)
    expect(record.envelopeFrom).toBe('sender@example.com')
    expect(record.envelopeTo).toBe('inbox@example.org')
    expect(record.rawSize).toBeGreaterThan(0)
    expect(record.sentAt.toISOString()).toBe('2026-07-07T10:00:00.000Z')
    expect(record.headers.some((h) => h.key === 'message-id')).toBe(true)
    expect(record.attachments).toEqual([])
  })

  it('generates a deterministic synthetic ID when Message-ID is missing', async () => {
    const raw = readFixture('no-message-id.eml')
    const first = await parseEmail(fakeMessage(raw))
    const second = await parseEmail(fakeMessage(raw))

    expect(first.messageId).toMatch(/^<synthetic-[0-9a-f]{64}@mail-app-ingest>$/)
    expect(first.messageId).toBe(second.messageId)
  })

  it('derives body_text from HTML-only mail', async () => {
    const record = await parseEmail(fakeMessage(readFixture('html-only.eml')))

    expect(record.bodyHtml).toContain('<h1>')
    expect(record.bodyText).toContain('Big news & updates')
    expect(record.bodyText).toContain('First paragraph of the newsletter.')
    expect(record.bodyText).not.toContain('color: red')
    expect(record.bodyText).not.toContain('<p>')
    expect(record.snippet).toContain('Big news')
  })

  it('caps oversized bodies and sets the truncated flag', async () => {
    const bigBody = 'x'.repeat(600 * 1024)
    const raw = [
      'From: big@example.com',
      'To: inbox@example.org',
      'Subject: Oversized',
      'Message-ID: <big-001@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      bigBody,
    ].join('\r\n')

    const record = await parseEmail(fakeMessage(raw))

    expect(record.truncated).toBe(true)
    expect(new TextEncoder().encode(record.bodyText).length).toBeLessThanOrEqual(512 * 1024)
  })

  it('extracts attachment metadata only', async () => {
    const record = await parseEmail(fakeMessage(readFixture('attachments.eml')))

    expect(record.attachments).toEqual([
      { filename: 'notes.txt', mime_type: 'text/plain', size: expect.any(Number) },
    ])
    expect(record.attachments[0].size).toBeGreaterThan(0)
    expect(JSON.stringify(record.attachments)).not.toContain('Hello attachment content')
  })

  it('falls back to the envelope sender when From is unparseable', async () => {
    const raw = ['To: inbox@example.org', 'Subject: No from', 'Message-ID: <nf-001@example.com>', '', 'Body'].join(
      '\r\n',
    )
    const record = await parseEmail(fakeMessage(raw))

    expect(record.fromAddress).toBe('sender@example.com')
  })
})

describe('htmlToText', () => {
  it('returns null for empty input', () => {
    expect(htmlToText(null)).toBeNull()
    expect(htmlToText('')).toBeNull()
  })

  it('converts breaks and paragraphs to newlines', () => {
    expect(htmlToText('<p>one</p><p>two<br>three</p>')).toBe('one\n\ntwo\nthree')
  })
})
