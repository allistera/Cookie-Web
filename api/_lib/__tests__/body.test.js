import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { readJsonBody } from '../body.js'

// Mirrors the shape readJsonBody actually consumes: an async-iterable of
// Buffer chunks, the same as a real Node.js IncomingMessage (what the local
// Vite dev middleware hands the handler when Vercel hasn't already parsed
// req.body).
function fakeStream(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk)
    },
  }
}

describe('readJsonBody', () => {
  it('parses a pre-parsed Vercel body as-is', async () => {
    await expect(readJsonBody({ body: { a: 1 } })).resolves.toEqual({ a: 1 })
  })

  it('parses a pre-parsed Vercel body given as a JSON string', async () => {
    await expect(readJsonBody({ body: '{"a":1}' })).resolves.toEqual({ a: 1 })
  })

  it('accumulates and parses a raw stream body', async () => {
    const req = fakeStream(['{"a":', '1}'])
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 })
  })

  it('returns an empty object for an empty raw stream body', async () => {
    await expect(readJsonBody(fakeStream([]))).resolves.toEqual({})
  })

  it('rejects a raw stream body over the size cap', async () => {
    const chunks = Array.from({ length: 5 }, () => 'a'.repeat(1024 * 1024))
    await expect(readJsonBody(fakeStream(chunks))).rejects.toThrow('too large')
  })
})
