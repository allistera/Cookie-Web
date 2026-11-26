import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CALENDAR_API_URL,
  DRAFTS_API_URL,
  EMAILS_API_URL,
  LABELS_API_URL,
  SEARCH_API_URL,
  TASKS_API_URL,
} from '../apiWorkers'
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

  // Every opened message loads the bridge inside its sandboxed frame; without
  // a lifetime each open revalidates it before the body can be sized.
  it('lets browsers keep the email body bridge script', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    const cached = config.headers.find(
      (entry) =>
        new RegExp(`^${entry.source}$`, 'u').test('/email-body-bridge.js') &&
        entry.headers.some((header) => header.key === 'Cache-Control'),
    )

    expect(cached?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=86400, stale-while-revalidate=604800',
    })
  })
})

describe('resource hints', () => {
  // index.html cannot import apiWorkers.js, so a Worker moving to another
  // domain would leave a hint opening a connection nothing uses. The hinted
  // origins are the ones called at boot: by App.vue on every route, and by
  // the default view (tasks) and its events card (calendar).
  it('preconnects to the Worker origins called at boot', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    const hinted = [...html.matchAll(/<link rel="preconnect" href="([^"]+)" crossorigin \/>/gu)]

    expect(hinted.map((match) => match[1]).toSorted()).toEqual(
      [
        CALENDAR_API_URL,
        DRAFTS_API_URL,
        EMAILS_API_URL,
        LABELS_API_URL,
        SEARCH_API_URL,
        TASKS_API_URL,
      ].toSorted(),
    )
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

  // The Vercel Toolbar needs its own script, frame, style, font and socket
  // origins. The app does not use it, so none of them is allowed.
  it('does not open the policy to the Vercel Toolbar', () => {
    const sources = Object.values(csp()).flat()
    for (const origin of [
      'https://vercel.live',
      'wss://ws-us3.pusher.com',
      'https://assets.vercel.com',
    ]) {
      expect(sources).not.toContain(origin)
    }
  })

  it('keeps script execution restricted to the app', () => {
    const policy = csp()
    expect(policy['script-src']).toEqual(["'self'"])
    expect(policy['object-src']).toEqual(["'none'"])
    expect(policy['frame-ancestors']).toEqual(["'none'"])
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
