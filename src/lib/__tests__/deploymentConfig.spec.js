import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

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

  // @vercel/blob's client upload (lib/attachmentUpload.js) asks
  // https://vercel.com/api/blob for its upload url before streaming the file
  // to *.vercel-storage.com; the browser refuses the first hop unless it is
  // listed, and an attachment then never leaves the composer.
  it('lets the composer reach Vercel Blob for attachment uploads', () => {
    const connect = csp()['connect-src']
    expect(connect).toContain('https://vercel.com')
    expect(connect).toContain('https://*.vercel-storage.com')
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
