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

    const hljs = await loadHighlighter('javascript')
    expect(await loadHighlighter('javascript')).toBe(hljs)
    // Only the requested grammar is fetched; others wait until asked for.
    expect(hljs.getLanguage('javascript')).toBeTruthy()
    expect(hljs.getLanguage('python')).toBeFalsy()
    expect(highlightCode('<p>hi</p>', 'html')).toBe(escapeCode('<p>hi</p>'))
    await loadHighlighter('html')

    const highlighted = highlightCode(source, 'javascript')
    expect(highlighted).toContain('hljs-keyword')
    expect(highlighted).toContain('hljs-string')
    expect(highlighted).toContain('&lt;b&gt;')
    expect(highlightCode('<p>hi</p>', 'html')).toContain('hljs-tag')
    // Plain text is never run through a grammar.
    expect(highlightCode(source, 'plaintext')).toBe(escapeCode(source))
  })

  it('loads the CSS and JavaScript grammars HTML embeds in style and script tags', async () => {
    const hljs = await loadHighlighter('html')
    expect(hljs.getLanguage('css')).toBeTruthy()
    expect(highlightCode('<style>a{color:red}</style>', 'html')).toContain('hljs-selector-tag')
    expect(highlightCode('<script>const x = 1</script>', 'html')).toContain('hljs-keyword')
  })

  it('has a loadable grammar for every dropdown language', async () => {
    for (const language of CODE_LANGUAGES.filter((entry) => entry.id !== 'plaintext')) {
      const hljs = await loadHighlighter(language.id)
      expect(hljs.getLanguage(language.hljs ?? language.id)).toBeTruthy()
    }
  })
})
