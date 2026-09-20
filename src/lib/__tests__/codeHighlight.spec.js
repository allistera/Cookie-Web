import { describe, expect, it } from 'vitest'

import {
  CODE_LANGUAGES,
  escapeCode,
  highlightCode,
  loadHighlighter,
  normalizeCodeLanguage,
} from '../codeHighlight.js'

describe('codeHighlight', () => {
  it('maps stored values onto dropdown languages and falls back to plain text', () => {
    expect(normalizeCodeLanguage('JavaScript')).toBe('javascript')
    expect(normalizeCodeLanguage(' html ')).toBe('html')
    expect(normalizeCodeLanguage('brainfuck')).toBe('plaintext')
    expect(normalizeCodeLanguage(undefined)).toBe('plaintext')
    expect(CODE_LANGUAGES[0].id).toBe('plaintext')
  })

  it('escapes markup until the highlighter has loaded, then highlights', async () => {
    const source = 'const x = "<b>";'
    expect(highlightCode(source, 'plaintext')).toBe(escapeCode(source))
    expect(highlightCode(source, 'plaintext')).toContain('&lt;b&gt;')

    const hljs = await loadHighlighter()
    expect(await loadHighlighter()).toBe(hljs)
    // Every dropdown language, including HTML's xml grammar, is registered.
    for (const language of CODE_LANGUAGES.filter((entry) => entry.id !== 'plaintext')) {
      expect(hljs.getLanguage(language.hljs ?? language.id)).toBeTruthy()
    }

    const highlighted = highlightCode(source, 'javascript')
    expect(highlighted).toContain('hljs-keyword')
    expect(highlighted).toContain('hljs-string')
    expect(highlighted).toContain('&lt;b&gt;')
    expect(highlightCode('<p>hi</p>', 'html')).toContain('hljs-tag')
    // Plain text is never run through a grammar.
    expect(highlightCode(source, 'plaintext')).toBe(escapeCode(source))
  })
})
