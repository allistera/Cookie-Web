import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadMaterialSymbols, MATERIAL_SYMBOL_NAMES } from '../iconFont'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The app loads only a subset of Material Symbols after authentication; a
// glyph outside it silently renders as its raw ligature text
// ("create_new_folder"). This test pins the list to what the source uses.

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
    const subset = new Set(MATERIAL_SYMBOL_NAMES)
    const missing = [...usedIcons()].filter((name) => !subset.has(name))
    expect(missing).toEqual([])
  })

  // Google's css2 endpoint 400s on an unsorted icon_names list, and a 400 costs
  // every icon in the app, not just the new one. An out-of-order insert shipped
  // once already, so the order is asserted rather than left to review.
  it('keeps icon_names sorted, as the Google Fonts API requires', () => {
    expect(MATERIAL_SYMBOL_NAMES).toEqual([...MATERIAL_SYMBOL_NAMES].sort())
  })

  it('loads the stylesheet at most once', () => {
    const applicationStyles = document.createElement('style')
    document.head.append(applicationStyles)
    loadMaterialSymbols(document)
    loadMaterialSymbols(document)

    const links = document.head.querySelectorAll('link[data-material-symbols]')
    expect(links).toHaveLength(1)
    expect(links[0].href).toContain(`icon_names=${MATERIAL_SYMBOL_NAMES.join(',')}`)
    expect(links[0].nextElementSibling).toBe(applicationStyles)
    links[0].dispatchEvent(new Event('load'))
    expect(document.documentElement.dataset.materialSymbols).toBe('loaded')
    links[0].remove()
    applicationStyles.remove()
    delete document.documentElement.dataset.materialSymbols
  })
})
