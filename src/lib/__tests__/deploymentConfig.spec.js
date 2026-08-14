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
