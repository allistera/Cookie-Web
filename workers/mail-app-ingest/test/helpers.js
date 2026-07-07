import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export function readFixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf-8')
}

// Minimal stand-in for ForwardableEmailMessage: postal-mime accepts a string
// for `raw`, so tests never need a ReadableStream.
export function fakeMessage(raw, { from = 'sender@example.com', to = 'inbox@example.org' } = {}) {
  return {
    from,
    to,
    raw,
    rawSize: new TextEncoder().encode(raw).length,
    forward: () => Promise.resolve(),
    setReject: () => {},
  }
}
