import { describe, expect, it } from 'vitest'

import { appendReadReceipt, buildReadReceiptUrl, parseRecipients } from '../send.js'

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
