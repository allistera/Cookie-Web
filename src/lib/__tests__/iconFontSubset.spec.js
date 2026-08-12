import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The app self-hosts only a subset of Material Symbols (index.html's
// icon_names list); a glyph outside it silently renders as its raw ligature
// text ("create_new_folder"). That has now shipped twice, so this test pins
// the list to what the source actually uses.

const ROOT = join(__dirname, '../../..')

function sourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (!/node_modules|__tests__/.test(path)) sourceFiles(path, files)
    } else if (/\.(vue|js)$/.test(entry)) {
      files.push(path)
    }
  }
  return files
}

function subsetFromIndexHtml() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  const match = html.match(/icon_names=([a-z_,]+)/)
  expect(match, 'index.html must declare an icon_names subset').toBeTruthy()
  return new Set(match[1].split(','))
}

function usedIcons() {
  const used = new Set()
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8')
    // Static ligatures — the closing tag may be wrapped by the formatter, so
    // tolerate whitespace/newlines around the name and before "</span".
    for (const span of src.matchAll(/material-symbols-outlined[^>]*>([^<]*)<\/span/gs)) {
      const body = span[1]
      const literal = body.trim()
      if (/^[a-z][a-z_]+$/.test(literal)) used.add(literal)
      // Dynamic ligatures inline in the span body: every quoted snake_case
      // string in its expressions is treated as an icon name.
      for (const m of body.matchAll(/'([a-z][a-z_]+)'/g)) used.add(m[1])
    }
    // Icon names carried in data (e.g. App.vue's APPS registry).
    for (const m of src.matchAll(/icon:\s*'([a-z][a-z_]+)'/g)) used.add(m[1])
  }
  return used
}

describe('Material Symbols subset', () => {
  it('covers every icon the source renders', () => {
    const subset = subsetFromIndexHtml()
    const missing = [...usedIcons()].filter((name) => !subset.has(name))
    expect(missing).toEqual([])
  })
})
