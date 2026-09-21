import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// Hand-picked z-index literals are how a composer ends up under a row menu and
// a toast under a modal: nothing in the build compares them. Every layer comes
// from the scale in main.css's :root instead, so the whole order is readable in
// one place. This pins that: a bare number in a z-index is a test failure.
const SRC = join(import.meta.dirname, '..', '..')

// The scale itself, lowest layer first.
const SCALE = [
  '--z-header',
  '--z-popover',
  '--z-drawer',
  '--z-composer',
  '--z-dropdown',
  '--z-modal',
  '--z-palette',
  '--z-toast',
  '--z-loading',
]

// Purely local stacking (a sticky row over the rows it scrolls past, siblings
// inside one component's own stacking context) carries no app-wide meaning, so
// these values stay literal.
const ALLOWED_LITERALS = new Set(['0', '1', '-1', 'auto', 'inherit', 'initial', 'unset', 'revert'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (entry === '__tests__' || entry === 'node_modules') continue
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(vue|css)$/.test(entry)) out.push(path)
  }
  return out
}

function zIndexDeclarations() {
  const found = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/z-index\s*:\s*([^;}\n]+)/g)) {
      const line = text.slice(0, match.index).split('\n').length
      found.push({ where: `${file.replace(SRC, 'src')}:${line}`, value: match[1].trim() })
    }
  }
  return found
}

describe('z-index scale', () => {
  it('defines the whole scale in :root', () => {
    const mainCss = readFileSync(join(SRC, 'assets', 'main.css'), 'utf8')
    const values = SCALE.map((token) => {
      const match = mainCss.match(new RegExp(`${token}\\s*:\\s*([0-9]+)`))
      return match ? Number(match[1]) : null
    })
    expect(values.some((value) => value === null)).toBe(false)
    // Declared low to high, so reading the list reads the stacking order.
    expect([...values].sort((a, b) => a - b)).toEqual(values)
  })

  it('never hard-codes a z-index outside the scale', () => {
    const offenders = zIndexDeclarations().filter(
      ({ value }) => !value.includes('var(--z-') && !ALLOWED_LITERALS.has(value),
    )
    expect(offenders).toEqual([])
  })

  it('finds z-index declarations to check', () => {
    // Guards the check above against a walk that silently stops matching.
    expect(zIndexDeclarations().length).toBeGreaterThan(20)
  })
})
