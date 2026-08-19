import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

const API_DIRECTORY = resolve(process.cwd(), 'api')
const VERCEL_HOBBY_FUNCTION_LIMIT = 12

describe('Vercel deployment shape', () => {
  it('keeps top-level API functions within the Hobby plan limit', async () => {
    const entries = await readdir(API_DIRECTORY, { withFileTypes: true })
    const functions = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map((entry) => entry.name)
      .sort()

    expect(functions.length, `Top-level functions: ${functions.join(', ')}`).toBeLessThanOrEqual(
      VERCEL_HOBBY_FUNCTION_LIMIT,
    )
  })
})
