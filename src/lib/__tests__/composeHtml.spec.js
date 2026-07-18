import { describe, it, expect } from 'vitest'

import { escapeHtml, plainTextToHtml } from '../composeHtml.js'

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<b>a & b</b>')).toBe('&lt;b&gt;a &amp; b&lt;/b&gt;')
  })
})

describe('plainTextToHtml', () => {
  it('is empty for blank input', () => {
    expect(plainTextToHtml('')).toBe('')
    expect(plainTextToHtml('   \n  ')).toBe('')
  })

  it('wraps blank-line blocks in paragraphs and single newlines in <br>', () => {
    expect(plainTextToHtml('Hi there,\n\nThanks for the note.')).toBe(
      '<p>Hi there,</p><p>Thanks for the note.</p>',
    )
    expect(plainTextToHtml('line one\nline two')).toBe('<p>line one<br>line two</p>')
  })

  it('escapes HTML so plain text cannot inject markup', () => {
    expect(plainTextToHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
  })
})
