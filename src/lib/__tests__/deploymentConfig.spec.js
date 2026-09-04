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
})
