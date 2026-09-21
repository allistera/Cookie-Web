import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// A var(--token) with no fallback silently resolves to nothing when the token
// is undefined — a transparent dropdown, a missing font — and nothing in the
// build catches it. This pins every no-fallback token use in src/ to a
// definition somewhere in src/.
const SRC = join(import.meta.dirname, '..', '..')

// Set at runtime by a third-party library on its own elements, never by us.
const EXTERNAL_TOKENS = new Set(['--radix-popper-available-width'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (entry === '__tests__' || entry === 'node_modules') continue
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(vue|css|js)$/.test(entry)) out.push(path)
  }
  return out
}

describe('CSS custom properties', () => {
  it('defines every custom property that is used without a fallback', () => {
    const files = walk(SRC)
    const defined = new Set()
    const used = new Map()
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      // Definitions in CSS (`--x: value`) and in Vue :style bindings (`'--x': value`).
      for (const match of text.matchAll(/(--[a-zA-Z0-9-]+)['"]?\s*:/g)) defined.add(match[1])
      for (const match of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
        if (!used.has(match[1])) used.set(match[1], file.replace(SRC, 'src'))
      }
    }
    const missing = [...used].filter(
      ([token]) => !defined.has(token) && !EXTERNAL_TOKENS.has(token),
    )
    expect(missing).toEqual([])
  })
})
