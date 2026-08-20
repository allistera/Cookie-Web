import { describe, expect, it } from 'vitest'

import {
  appendReadReceipt,
  buildReadReceiptUrl,
  claimOutboundEmailQuota,
  parseRecipients,
  validateOutboundMessage,
} from '../send.js'

describe('parseRecipients', () => {
  it('parses a comma-separated to field into trimmed addresses', () => {
    expect(parseRecipients('a@b.com, c@d.com')).toEqual(['a@b.com', 'c@d.com'])
    expect(parseRecipients(' a@b.com ')).toEqual(['a@b.com'])
    expect(parseRecipients('a@b.com,,c@d.com,')).toEqual(['a@b.com', 'c@d.com'])
  })

  it('returns an empty list for non-strings or blank input', () => {
    expect(parseRecipients('')).toEqual([])
    expect(parseRecipients(undefined)).toEqual([])
    expect(parseRecipients(null)).toEqual([])
    expect(parseRecipients(42)).toEqual([])
  })

  it('rejects recipient fan-out above the application limit', () => {
    const recipients = Array.from({ length: 21 }, (_, index) => `user${index}@example.com`).join(
      ',',
    )

    expect(parseRecipients(recipients)).toEqual([])
  })
})

describe('outbound email abuse bounds', () => {
  const valid = {
    to: 'recipient@example.com',
    subject: 'Hello',
    text: 'Plain text',
    html: '<p>Plain text</p>',
  }

  it('accepts a normal bounded message', () => {
    expect(validateOutboundMessage(valid)).toEqual({
      recipients: ['recipient@example.com'],
      bodyHtml: '<p>Plain text</p>',
    })
  })

  it('rejects oversized subject, text, HTML, and aggregate content', () => {
    expect(validateOutboundMessage({ ...valid, subject: 'x'.repeat(999) }).error).toMatch(/size/i)
    expect(validateOutboundMessage({ ...valid, text: 'x'.repeat(100_001) }).error).toMatch(/size/i)
    expect(validateOutboundMessage({ ...valid, html: 'x'.repeat(200_001) }).error).toMatch(/size/i)
    expect(
      validateOutboundMessage({ ...valid, text: 'x'.repeat(100_000), html: 'y'.repeat(160_000) })
        .error,
    ).toMatch(/size/i)
  })

  it('uses one atomic server-side quota claim scoped to a provisioned user', async () => {
    let query = ''
    const values = []
    const sql = (strings, ...parameters) => {
      query = strings.join('?')
      values.push(...parameters)
      return [{ authorized: true, quota_claimed: true }]
    }
    const userId = '11111111-1111-4111-8111-111111111111'

    await expect(claimOutboundEmailQuota(sql, userId)).resolves.toEqual({
      authorized: true,
      quota_claimed: true,
    })
    expect(query).toContain('INSERT INTO outbound_email_quotas')
    expect(query).toContain('ON CONFLICT (user_id) DO UPDATE')
    expect(query).toContain('outbound_email_quotas.send_count <')
    expect(values).toEqual([userId, 10, userId])
  })
})

describe('read receipt helpers', () => {
  const token = '11111111-1111-4111-8111-111111111111'

  it('builds an opaque-token URL from the configured public origin', () => {
    expect(buildReadReceiptUrl(token, { PUBLIC_APP_URL: 'https://mail.example.com/app' })).toBe(
      `https://mail.example.com/api/read-receipts?token=${token}`,
    )
    expect(buildReadReceiptUrl(token, { VERCEL_PROJECT_PRODUCTION_URL: 'cookie.vercel.app' })).toBe(
      `https://cookie.vercel.app/api/read-receipts?token=${token}`,
    )
  })

  it('adds the pixel to sent HTML and safely creates HTML for plain text', () => {
    const url = `https://mail.example.com/api/read-receipts?token=${token}`
    expect(appendReadReceipt('<p>Hello</p>', 'Hello', url)).toContain(
      `<p>Hello</p><img src="${url}"`,
    )
    const fromText = appendReadReceipt(null, '<Hello>\nWorld', url)
    expect(fromText).toContain('&lt;Hello&gt;<br>World')
    expect(fromText).not.toContain('<Hello>')
  })
})
