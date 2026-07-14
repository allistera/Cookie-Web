import { describe, it, expect } from 'vitest'

import { parseListUnsubscribe, isSafeUnsubscribeUrl } from '../unsubscribe.js'

const h = (key, value) => ({ key, value })

describe('parseListUnsubscribe', () => {
  it('returns null when headers are null or undefined', () => {
    expect(parseListUnsubscribe(null)).toBeNull()
    expect(parseListUnsubscribe(undefined)).toBeNull()
  })

  it('returns null for a non-array (malformed) headers value', () => {
    expect(parseListUnsubscribe('List-Unsubscribe: <x>')).toBeNull()
    expect(parseListUnsubscribe({ key: 'List-Unsubscribe', value: '<x>' })).toBeNull()
    expect(parseListUnsubscribe(42)).toBeNull()
  })

  it('returns null when no List-Unsubscribe header is present', () => {
    expect(parseListUnsubscribe([h('Subject', 'Hi'), h('From', 'a@b.com')])).toBeNull()
  })

  it('returns null when the header has no usable URI', () => {
    expect(parseListUnsubscribe([h('List-Unsubscribe', 'not a uri at all')])).toBeNull()
    expect(parseListUnsubscribe([h('List-Unsubscribe', '<ftp://x.example/u>')])).toBeNull()
    expect(parseListUnsubscribe([h('List-Unsubscribe', '<>')])).toBeNull()
  })

  it('parses a url-only List-Unsubscribe', () => {
    const r = parseListUnsubscribe([h('List-Unsubscribe', '<https://x.example/u?t=1>')])
    expect(r).toEqual({ oneClick: false, url: 'https://x.example/u?t=1', mailto: null })
  })

  it('parses an http url as well as https', () => {
    const r = parseListUnsubscribe([h('List-Unsubscribe', '<http://x.example/u>')])
    expect(r.url).toBe('http://x.example/u')
  })

  it('parses a mailto-only List-Unsubscribe', () => {
    const r = parseListUnsubscribe([h('List-Unsubscribe', '<mailto:unsub@x.example>')])
    expect(r).toEqual({
      oneClick: false,
      url: null,
      mailto: { address: 'unsub@x.example', subject: null },
    })
  })

  it('extracts the subject query param from a mailto', () => {
    const r = parseListUnsubscribe([
      h('List-Unsubscribe', '<mailto:unsub@x.example?subject=stop>'),
    ])
    expect(r.mailto).toEqual({ address: 'unsub@x.example', subject: 'stop' })
  })

  it('decodes an encoded mailto subject', () => {
    const r = parseListUnsubscribe([
      h('List-Unsubscribe', '<mailto:unsub@x.example?subject=Unsub%20me>'),
    ])
    expect(r.mailto.subject).toBe('Unsub me')
  })

  it('parses both a url and a mailto from a comma-separated value', () => {
    const r = parseListUnsubscribe([
      h(
        'List-Unsubscribe',
        '<https://x.example/u?t=1>, <mailto:unsub@x.example?subject=stop>',
      ),
    ])
    expect(r).toEqual({
      oneClick: false,
      url: 'https://x.example/u?t=1',
      mailto: { address: 'unsub@x.example', subject: 'stop' },
    })
  })

  it('takes the first http(s) URI and the first mailto when several are present', () => {
    const r = parseListUnsubscribe([
      h(
        'List-Unsubscribe',
        '<https://a.example/1>, <https://b.example/2>, <mailto:one@x.example>, <mailto:two@x.example>',
      ),
    ])
    expect(r.url).toBe('https://a.example/1')
    expect(r.mailto.address).toBe('one@x.example')
  })

  it('matches header keys case-insensitively', () => {
    const r = parseListUnsubscribe([h('list-UNSUBSCRIBE', '<https://x.example/u>')])
    expect(r.url).toBe('https://x.example/u')
  })

  it('marks oneClick true only with List-Unsubscribe-Post AND an http(s) url', () => {
    const r = parseListUnsubscribe([
      h('List-Unsubscribe', '<https://x.example/u>'),
      h('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'),
    ])
    expect(r.oneClick).toBe(true)
    expect(r.url).toBe('https://x.example/u')
  })

  it('matches the List-Unsubscribe-Post value case-insensitively', () => {
    const r = parseListUnsubscribe([
      h('List-Unsubscribe', '<https://x.example/u>'),
      h('list-unsubscribe-post', 'list-unsubscribe=ONE-CLICK'),
    ])
    expect(r.oneClick).toBe(true)
  })

  it('does not set oneClick when the Post header value is unexpected', () => {
    const r = parseListUnsubscribe([
      h('List-Unsubscribe', '<https://x.example/u>'),
      h('List-Unsubscribe-Post', 'something-else'),
    ])
    expect(r.oneClick).toBe(false)
  })

  it('does not set oneClick when there is only a mailto (no http url)', () => {
    const r = parseListUnsubscribe([
      h('List-Unsubscribe', '<mailto:unsub@x.example>'),
      h('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'),
    ])
    expect(r.oneClick).toBe(false)
    expect(r.mailto.address).toBe('unsub@x.example')
  })

  it('skips malformed/garbage URIs but keeps usable ones', () => {
    const r = parseListUnsubscribe([
      h('List-Unsubscribe', '<not a url>, <ht!tp://bad>, <https://x.example/u>'),
    ])
    expect(r.url).toBe('https://x.example/u')
  })

  it('never throws on garbage values', () => {
    expect(() => parseListUnsubscribe([h('List-Unsubscribe', '<<<>>><')])).not.toThrow()
    expect(() => parseListUnsubscribe([h('List-Unsubscribe', 'mailto:')])).not.toThrow()
    expect(parseListUnsubscribe([h('List-Unsubscribe', '<mailto:>')])).toBeNull()
  })

  it('tolerates malformed entries in the array (missing key/value)', () => {
    const r = parseListUnsubscribe([
      null,
      { key: 'List-Unsubscribe' },
      { value: '<https://x.example/u>' },
      h('List-Unsubscribe', '<https://x.example/u>'),
    ])
    expect(r.url).toBe('https://x.example/u')
  })
})

describe('isSafeUnsubscribeUrl', () => {
  it('accepts a public https url', () => {
    expect(isSafeUnsubscribeUrl('https://x.example/u?t=1')).toBe(true)
    expect(isSafeUnsubscribeUrl('https://sub.domain.example.com/path')).toBe(true)
  })

  it('rejects non-string / unparseable input without throwing', () => {
    expect(isSafeUnsubscribeUrl('not a url')).toBe(false)
    expect(isSafeUnsubscribeUrl('')).toBe(false)
    expect(isSafeUnsubscribeUrl(null)).toBe(false)
    expect(isSafeUnsubscribeUrl(undefined)).toBe(false)
  })

  it('rejects non-https schemes', () => {
    expect(isSafeUnsubscribeUrl('http://x.example/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('mailto:unsub@x.example')).toBe(false)
    expect(isSafeUnsubscribeUrl('ftp://x.example/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects localhost and localhost subdomains', () => {
    expect(isSafeUnsubscribeUrl('https://localhost/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://api.localhost/u')).toBe(false)
  })

  it('rejects IPv4 literals including private and link-local ranges', () => {
    expect(isSafeUnsubscribeUrl('https://127.0.0.1/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://10.0.0.1/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://192.168.1.1/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://172.16.0.1/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://8.8.8.8/u')).toBe(false)
  })

  it('rejects IPv6 literals (bracketed)', () => {
    expect(isSafeUnsubscribeUrl('https://[::1]/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://[2001:db8::1]/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://[fe80::1]/u')).toBe(false)
  })

  it('rejects numeric-shorthand and decimal IP forms', () => {
    expect(isSafeUnsubscribeUrl('https://127.1/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://2130706433/u')).toBe(false)
  })

  it('rejects embedded credentials', () => {
    expect(isSafeUnsubscribeUrl('https://user:pass@x.example/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://user@x.example/u')).toBe(false)
  })

  it('rejects explicit non-default ports', () => {
    expect(isSafeUnsubscribeUrl('https://x.example:8443/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://x.example:80/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://x.example:8080/u')).toBe(false)
  })

  it('allows an explicit default https port (normalized away by URL)', () => {
    // :443 is the https default; the URL parser drops it, so port is empty.
    expect(isSafeUnsubscribeUrl('https://x.example:443/u')).toBe(true)
  })

  it('rejects single-label hostnames', () => {
    expect(isSafeUnsubscribeUrl('https://intranet/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://server/u')).toBe(false)
  })

  it('rejects internal-style suffixes', () => {
    expect(isSafeUnsubscribeUrl('https://printer.local/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://db.internal/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://host.lan/u')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://svc.home.arpa/u')).toBe(false)
  })
})
