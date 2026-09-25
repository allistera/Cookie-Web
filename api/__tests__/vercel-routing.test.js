import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))

// Vercel rewrite sources are path-to-regexp patterns; the SPA fallback is a
// single capture group, so it can be checked as a plain anchored RegExp.
function spaRewriteMatches(pathname) {
  const rewrite = config.rewrites.find((entry) => entry.destination === '/index.html')
  return new RegExp(`^${rewrite.source}$`).test(pathname)
}

describe('SPA rewrite', () => {
  it('serves index.html for client routes', () => {
    expect(spaRewriteMatches('/inbox')).toBe(true)
    expect(spaRewriteMatches('/')).toBe(true)
  })

  // A missing hashed chunk answered with index.html would be cached as
  // immutable (and cache-first by the service worker) under a script URL.
  it('lets a missing build asset 404 instead of answering with index.html', () => {
    expect(spaRewriteMatches('/assets/index-missing.js')).toBe(false)
    expect(spaRewriteMatches('/api/send')).toBe(false)
  })
})

describe('page security headers', () => {
  it('isolates the browsing context from cross-origin openers', () => {
    const pages = config.headers.find((entry) => entry.source === '/((?!api/).*)')
    expect(pages.headers).toContainEqual({
      key: 'Cross-Origin-Opener-Policy',
      value: 'same-origin',
    })
  })
})
