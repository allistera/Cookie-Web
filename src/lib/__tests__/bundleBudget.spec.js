import { describe, expect, it } from 'vitest'
import { staticGraphBytes } from '../../../scripts/bundleBudget.mjs'

describe('startup bundle accounting', () => {
  it('includes shared imports once, terminates cycles, and excludes optional features', () => {
    const chunk = (code, imports = []) => ({ type: 'chunk', code, imports })
    const bundle = {
      entry: chunk('123', ['shared', 'other']),
      shared: chunk('12345', ['entry']),
      other: chunk('12', ['shared']),
      optional: chunk('x'.repeat(1000)),
    }
    expect(staticGraphBytes(bundle, 'entry')).toBe(10)
  })
})
