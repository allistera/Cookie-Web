import { describe, expect, it } from 'vitest'

import {
  bridgeCandidateIsPlausible,
  selectPlainTextUnsubscribeTarget,
  selectUnsubscribeTarget,
} from '../unsubscribeContent'

describe('selectUnsubscribeTarget', () => {
  it('selects an exact unsubscribe label and preserves the canonical target', () => {
    const target = selectUnsubscribeTarget([
      {
        href: 'https://news.example/unsubscribe?token=a%2Fb%26c',
        text: 'Unsubscribe',
      },
    ])

    expect(target).toEqual({
      oneClick: false,
      href: 'https://news.example/unsubscribe?token=a%2Fb%26c',
      url: 'https://news.example/unsubscribe?token=a%2Fb%26c',
      mailto: null,
      source: 'content',
    })
  })

  it('recognizes encoded unsubscribe query values without opening a decoded URL', () => {
    const href = 'https://news.example/preferences?action=%75nsubscribe&token=a%26b'
    expect(bridgeCandidateIsPlausible({ href })).toBe(true)
    expect(selectUnsubscribeTarget([{ href }])?.href).toBe(href)
  })

  it('uses adjacent footer prose for an opaque click-here link', () => {
    const target = selectUnsubscribeTarget([
      {
        href: 'https://news.example/t/opaque-signed-token',
        text: 'click here',
        context: 'To unsubscribe from these emails, click here.',
      },
    ])
    expect(target?.url).toBe('https://news.example/t/opaque-signed-token')
  })

  it('recognizes image alt text for image-only footer links', () => {
    const target = selectUnsubscribeTarget([
      { href: 'https://news.example/t/opaque', imageAlt: 'Unsubscribe' },
    ])
    expect(target?.url).toBe('https://news.example/t/opaque')
  })

  it('rejects unsafe and ambiguous targets', () => {
    expect(
      selectUnsubscribeTarget([{ href: 'https://localhost/unsubscribe', text: 'Unsubscribe' }]),
    ).toBeNull()
    expect(
      selectUnsubscribeTarget([
        { href: 'https://one.example/u', text: 'Unsubscribe' },
        { href: 'https://two.example/u', text: 'Unsubscribe' },
      ]),
    ).toBeNull()
  })

  it('rebuilds a strict mailto and rejects dangerous mail headers', () => {
    expect(
      selectUnsubscribeTarget([
        { href: 'mailto:leave@news.example?subject=Remove%20me', text: 'Unsubscribe' },
      ]),
    ).toMatchObject({
      href: 'mailto:leave@news.example?subject=Remove%20me',
      mailto: { address: 'leave@news.example', subject: 'Remove me' },
    })
    expect(
      selectUnsubscribeTarget([
        { href: 'mailto:leave@news.example?bcc=other@example.com', text: 'Unsubscribe' },
      ]),
    ).toBeNull()
    expect(
      selectUnsubscribeTarget([{ href: 'mailto:leave%0d%0a@news.example', text: 'Unsubscribe' }]),
    ).toBeNull()
  })

  it('rejects over-limit hrefs whole', () => {
    expect(
      selectUnsubscribeTarget([
        { href: `https://news.example/unsubscribe?token=${'a'.repeat(5000)}`, text: 'Unsubscribe' },
      ]),
    ).toBeNull()
  })
})

describe('selectPlainTextUnsubscribeTarget', () => {
  it('extracts one adjacent unsubscribe target', () => {
    expect(
      selectPlainTextUnsubscribeTarget(
        'Thanks for reading.\nTo unsubscribe visit https://news.example/unsubscribe?id=123',
      )?.url,
    ).toBe('https://news.example/unsubscribe?id=123')
  })

  it('fails closed when a relevant line contains multiple targets', () => {
    expect(
      selectPlainTextUnsubscribeTarget(
        'Unsubscribe: https://one.example/u or https://two.example/u',
      ),
    ).toBeNull()
  })
})
