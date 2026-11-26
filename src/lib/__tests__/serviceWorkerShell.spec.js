import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('service worker shell', () => {
  // The worker matches cached requests by their whole URL, so the precached
  // bridge must carry the same ?v= as the URL the reader frame loads.
  it('precaches the email body bridge at the URL the reader requests', () => {
    const reader = readFileSync(join(ROOT, 'src/components/EmailBody.vue'), 'utf8')
    const bridgeUrl = reader.match(/const emailBodyBridgeUrl = '([^']+)'/)?.[1]
    expect(bridgeUrl).toMatch(/^\/email-body-bridge\.js\?v=\d+$/)
    const worker = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')
    expect(worker).toContain(`'${bridgeUrl}',`)
  })
})
