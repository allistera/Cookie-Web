import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SENTRY_TUNNEL_PATH } from '../sentryPrivacy'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('deployment caching', () => {
  it('serves hashed Vite assets with immutable browser caching', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    const assets = config.headers.find((entry) => entry.source === '/assets/(.*)')

    expect(assets?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable',
    })
  })
})

describe('content security policy', () => {
  function csp() {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    const pages = config.headers.find((entry) => entry.source === '/((?!api/).*)')
    const header = pages.headers.find((entry) => entry.key === 'Content-Security-Policy')
    return Object.fromEntries(
      header.value.split(';').map((directive) => {
        const [name, ...sources] = directive.trim().split(/\s+/)
        return [name, sources]
      }),
    )
  }

  // Composer uploads post to the send Worker (lib/attachmentUpload.js) like
  // every other Worker call, so the browser no longer needs a connect-src
  // opening to Vercel Blob or vercel.com; only images still come from Blob.
  it('keeps browser connections to the Workers and off Vercel Blob', () => {
    const policy = csp()
    expect(policy['connect-src']).toContain('https://*.infinitywave.online')
    expect(policy['connect-src']).not.toContain('https://vercel.com')
    expect(policy['connect-src']).not.toContain('https://*.vercel-storage.com')
    expect(policy['img-src']).toContain('https://*.vercel-storage.com')
  })

  it.each([
    ['script-src', ['https://vercel.live']],
    ['connect-src', ['https://vercel.live', 'wss://ws-us3.pusher.com']],
    ['frame-src', ['https://vercel.live']],
    ['style-src', ['https://vercel.live']],
    ['font-src', ['https://vercel.live', 'https://assets.vercel.com']],
  ])('allows the Vercel Toolbar resources in %s', (directive, sources) => {
    expect(csp()[directive]).toEqual(expect.arrayContaining(sources))
  })

  it('keeps script execution restricted to the app and Vercel Toolbar', () => {
    const policy = csp()
    expect(policy['script-src']).toEqual(["'self'", 'https://vercel.live'])
    expect(policy['object-src']).toEqual(["'none'"])
    expect(policy['frame-ancestors']).toEqual(["'none'"])
    // The existing HTTPS image policy already covers Vercel Toolbar images.
    expect(policy['img-src']).toEqual(expect.arrayContaining(['https:', 'data:', 'blob:']))
  })
})

describe('sentry tunnel', () => {
  function rewrites() {
    return JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).rewrites
  }

  // Ad and privacy blockers cancel requests to *.ingest.sentry.io, so the SDK
  // posts envelopes to a same-origin path that Vercel proxies to Sentry.
  it('proxies the SDK tunnel path to the Sentry envelope endpoint', () => {
    const tunnel = rewrites().find((entry) => entry.source === SENTRY_TUNNEL_PATH)
    expect(tunnel?.destination).toMatch(
      /^https:\/\/o\d+\.ingest\.(?:de|us)\.sentry\.io\/api\/\d+\/envelope\/$/u,
    )
  })

  // Vercel applies the first matching rewrite, so the SPA fallback must not
  // swallow tunnel posts and answer them with index.html.
  it('matches the tunnel before the single-page app fallback', () => {
    const sources = rewrites().map((entry) => entry.source)
    expect(sources.indexOf(SENTRY_TUNNEL_PATH)).toBeLessThan(
      sources.indexOf('/((?!api/|assets/).*)'),
    )
    expect(sources.indexOf(SENTRY_TUNNEL_PATH)).toBeGreaterThanOrEqual(0)
  })
})
