import { describe, expect, it } from 'vitest'

import { applyMarkdownFormat, renderTaskMarkdown } from '../taskMarkdown'

describe('renderTaskMarkdown', () => {
  it('renders headings, paragraphs and fenced code as blocks', () => {
    const html = renderTaskMarkdown('# heading 1\n\nParagraph\n\n```\nvar = "foo"\n```')
    expect(html).toBe('<h1>heading 1</h1><p>Paragraph</p><pre><code>var = "foo"</code></pre>')
  })

  it('renders lists and quotes', () => {
    expect(renderTaskMarkdown('- one\n- two\n\n1. first\n2) second\n\n> quoted\n> twice')).toBe(
      '<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>' +
        '<blockquote><p>quoted<br>twice</p></blockquote>',
    )
  })

  it('keeps single newlines inside a paragraph as line breaks', () => {
    expect(renderTaskMarkdown('First line\nSecond line')).toBe('<p>First line<br>Second line</p>')
  })

  it('renders inline marks and leaves code spans alone', () => {
    expect(renderTaskMarkdown('**bold** *it* _also_ ~~gone~~ `a*b*c`')).toBe(
      '<p><strong>bold</strong> <em>it</em> <em>also</em> <s>gone</s> <code>a*b*c</code></p>',
    )
  })

  it('links only to web and mail addresses', () => {
    expect(renderTaskMarkdown('[site](https://example.com) [mail](mailto:a@b.c)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a> ' +
        '<a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">mail</a></p>',
    )
    expect(renderTaskMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>')
  })

  it('never passes markup through', () => {
    expect(renderTaskMarkdown('<img src=x onerror=alert(1)> & <b>bold</b>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;bold&lt;/b&gt;</p>',
    )
  })

  it('renders nothing for an empty description', () => {
    expect(renderTaskMarkdown('')).toBe('')
    expect(renderTaskMarkdown(null)).toBe('')
    expect(renderTaskMarkdown('  \n ')).toBe('')
  })

  it('closes an unterminated fence at the end', () => {
    expect(renderTaskMarkdown('```\ncode')).toBe('<pre><code>code</code></pre>')
  })
})

describe('applyMarkdownFormat', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(applyMarkdownFormat('make it bold', 8, 12, 'bold')).toEqual({
      value: 'make it **bold**',
      selectionStart: 10,
      selectionEnd: 14,
    })
  })

  it('unwraps a selection that is already wrapped', () => {
    expect(applyMarkdownFormat('make it **bold**', 10, 14, 'bold')).toEqual({
      value: 'make it bold',
      selectionStart: 8,
      selectionEnd: 12,
    })
  })

  it('inserts a pair of marks for the caret to type between', () => {
    expect(applyMarkdownFormat('', 0, 0, 'italic')).toEqual({
      value: '**',
      selectionStart: 1,
      selectionEnd: 1,
    })
  })

  it('makes a fenced block from a multi-line code selection', () => {
    expect(applyMarkdownFormat('a\nb', 0, 3, 'code').value).toBe('\n```\na\nb\n```\n')
  })

  it('prefixes every selected line and selects the block', () => {
    expect(applyMarkdownFormat('one\ntwo\nthree', 5, 10, 'bullet')).toEqual({
      value: 'one\n- two\n- three',
      selectionStart: 4,
      selectionEnd: 17,
    })
  })

  it('numbers lines in order and swaps one line mark for another', () => {
    expect(applyMarkdownFormat('- a\n- b', 0, 7, 'numbered').value).toBe('1. a\n2. b')
    expect(applyMarkdownFormat('1. a', 0, 0, 'heading').value).toBe('# a')
    expect(applyMarkdownFormat('# a', 1, 1, 'quote').value).toBe('> a')
  })

  it('removes a line mark every selected line already has', () => {
    expect(applyMarkdownFormat('# a', 0, 0, 'heading').value).toBe('a')
    expect(applyMarkdownFormat('1. a\n2. b', 0, 9, 'numbered').value).toBe('a\nb')
  })

  it('builds a link around the selection and selects the address', () => {
    expect(applyMarkdownFormat('see docs now', 4, 8, 'link')).toEqual({
      value: 'see [docs](https://) now',
      selectionStart: 11,
      selectionEnd: 19,
    })
    expect(applyMarkdownFormat('', 0, 0, 'link').value).toBe('[link text](https://)')
  })

  it('leaves the text alone for an unknown format', () => {
    expect(applyMarkdownFormat('x', 0, 1, 'nope')).toEqual({
      value: 'x',
      selectionStart: 0,
      selectionEnd: 1,
    })
  })
})
