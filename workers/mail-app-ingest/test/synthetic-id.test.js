import { describe, expect, it } from 'vitest'

import { syntheticMessageId } from '../src/synthetic-id.js'

const input = {
  from: 'sender@example.com',
  to: 'inbox@example.org',
  date: '2026-07-07T10:00:00.000Z',
  subject: 'Hello',
  bodyPrefix: 'Body text',
}

describe('syntheticMessageId', () => {
  it('is deterministic for identical input', async () => {
    expect(await syntheticMessageId(input)).toBe(await syntheticMessageId({ ...input }))
  })

  it('changes when any component changes', async () => {
    expect(await syntheticMessageId(input)).not.toBe(
      await syntheticMessageId({ ...input, subject: 'Different' }),
    )
  })

  it('tolerates missing components', async () => {
    const id = await syntheticMessageId({ from: 'a@b.c' })
    expect(id).toMatch(/^<synthetic-[0-9a-f]{64}@mail-app-ingest>$/)
  })
})
