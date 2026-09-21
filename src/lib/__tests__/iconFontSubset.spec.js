import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadMaterialSymbols,
  MATERIAL_SYMBOL_NAMES,
  MATERIAL_SYMBOLS_STYLESHEET_URL,
} from '../iconFont'

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

  // Google's css2 endpoint 400s on an unsorted icon_names list, and a 400 means
  // scripts/fetch-icon-font.mjs regenerates nothing at all. An out-of-order
  // insert shipped once already, so the order is asserted rather than left to
  // review.
  it('keeps icon_names sorted, as the Google Fonts API requires', () => {
    expect(MATERIAL_SYMBOL_NAMES).toEqual([...MATERIAL_SYMBOL_NAMES].sort())
  })
})

// The subset is self-hosted so an installed PWA started offline still renders
// icons; nothing on the render path may point at fonts.googleapis.com.
describe('self-hosted Material Symbols subset', () => {
  it('ships the generated stylesheet and a real woff2', () => {
    const css = readFileSync(join(ROOT, 'public/fonts/material-symbols-outlined.css'), 'utf8')
    expect(css).toContain("font-family: 'Material Symbols Outlined'")
    expect(css).toContain('font-display: block')
    expect(css).toContain('url(/fonts/material-symbols-outlined.woff2)')
    expect(css).not.toContain('fonts.gstatic.com')

    const woff2 = readFileSync(join(ROOT, 'public/fonts/material-symbols-outlined.woff2'))
    expect(woff2.subarray(0, 4).toString('latin1')).toBe('wOF2')
  })

  it('precaches the font files in the service worker shell', () => {
    const worker = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')
    expect(worker).toContain("'/fonts/material-symbols-outlined.css'")
    expect(worker).toContain("'/fonts/material-symbols-outlined.woff2'")
  })
})

describe('loadMaterialSymbols', () => {
  afterEach(() => {
    for (const link of document.head.querySelectorAll('link[data-material-symbols], style')) {
      link.remove()
    }
    delete document.documentElement.dataset.materialSymbols
    delete document.fonts
  })

  // jsdom has no FontFaceSet, so the loader's document.fonts use is stubbed.
  function stubFontFaceSet(load) {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
  }

  function injectStylesheet() {
    const applicationStyles = document.createElement('style')
    document.head.append(applicationStyles)
    loadMaterialSymbols(document)
    loadMaterialSymbols(document)

    const links = document.head.querySelectorAll('link[data-material-symbols]')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(MATERIAL_SYMBOLS_STYLESHEET_URL)
    expect(links[0].nextElementSibling).toBe(applicationStyles)
    return links[0]
  }

  it('requests the local stylesheet once, ahead of application CSS', () => {
    stubFontFaceSet(vi.fn().mockResolvedValue([{}]))
    const link = injectStylesheet()

    expect(MATERIAL_SYMBOLS_STYLESHEET_URL).toBe('/fonts/material-symbols-outlined.css')
    expect(link.getAttribute('href')).not.toContain('fonts.googleapis.com')
    expect(document.documentElement.dataset.materialSymbols).toBe('loading')
  })

  // The stylesheet's load event only means the @font-face rule parsed. Icons
  // stay hidden until the woff2 itself is ready, or font-display: block would
  // expire and paint raw ligature text such as "calendar_month".
  it('waits for the font file before revealing icons', async () => {
    const load = vi.fn().mockResolvedValue([{}])
    stubFontFaceSet(load)
    const link = injectStylesheet()

    link.dispatchEvent(new Event('load'))
    expect(document.documentElement.dataset.materialSymbols).toBe('loading')
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.materialSymbols).toBe('loaded')
    })
    expect(load).toHaveBeenCalledWith('24px "Material Symbols Outlined"')
  })

  it('reports an error when the font file fails to load', async () => {
    stubFontFaceSet(vi.fn().mockRejectedValue(new Error('NetworkError')))
    const link = injectStylesheet()

    link.dispatchEvent(new Event('load'))
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.materialSymbols).toBe('error')
    })
  })

  it('reports an error when the stylesheet declares no matching face', async () => {
    stubFontFaceSet(vi.fn().mockResolvedValue([]))
    const link = injectStylesheet()

    link.dispatchEvent(new Event('load'))
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.materialSymbols).toBe('error')
    })
  })

  it('reports an error when the stylesheet itself fails to load', () => {
    stubFontFaceSet(vi.fn())
    const link = injectStylesheet()

    link.dispatchEvent(new Event('error'))
    expect(document.documentElement.dataset.materialSymbols).toBe('error')
  })

  // Browsers without FontFaceSet still get icons: the stylesheet's load event
  // is enough there.
  it('falls back to the stylesheet load event without FontFaceSet', async () => {
    const link = injectStylesheet()

    link.dispatchEvent(new Event('load'))
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.materialSymbols).toBe('loaded')
    })
  })
})
