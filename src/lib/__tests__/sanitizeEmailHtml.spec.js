import { describe, it, expect } from 'vitest'

import { sanitizeEmailHtml } from '../sanitizeEmailHtml'

// body_html is arbitrary, sender-controlled HTML. These tests pin the
// first defence-in-depth layer: the output must never carry executable
// script, event handlers, dangerous URI schemes, or form/meta/link vectors,
// while preserving benign formatting (tables, inline styles, images).
describe('sanitizeEmailHtml', () => {
  // Some senders paint their text white and set the page colour on <body>.
  // Sanitizing keeps only the body's contents, so without carrying the
  // background across the reader shows white text on its own white panel.
  it('keeps a background colour set on <body> by wrapping the content', () => {
    const out = sanitizeEmailHtml(
      '<html><body style="background-color: #1a1a2e;"><p style="color:#fff">hi</p></body></html>',
    )
    expect(out).toContain('<p style="color:#fff">hi</p>')
    expect(out).toMatch(/^<div style="[^"]*background-color:\s*#1a1a2e[^"]*">/)
    expect(out).toMatch(/<\/div>$/)
  })

  it('keeps a legacy bgcolor attribute on <body> as a background colour', () => {
    const out = sanitizeEmailHtml('<body bgcolor="#123456"><p>hi</p></body>')
    expect(out).toMatch(/^<div style="[^"]*background-color:\s*#123456[^"]*">/)
    expect(out).toContain('<p>hi</p>')
  })

  it('adds no wrapper when <body> carries no background', () => {
    expect(sanitizeEmailHtml('<p>hi</p>')).toBe('<p>hi</p>')
    expect(sanitizeEmailHtml('<html><body><p>hi</p></body></html>')).toBe('<p>hi</p>')
  })

  it('still strips event handlers declared on <body>', () => {
    const out = sanitizeEmailHtml(
      '<body style="background:#000" onload="window.evil = 1"><p>hi</p></body>',
    )
    expect(out.toLowerCase()).not.toContain('onload')
    expect(out).not.toContain('window.evil')
    expect(out).toContain('background:#000')
  })

  it('strips <script> tags', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>window.evil = 1</script>')
    expect(out).toContain('<p>hi</p>')
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).not.toContain('window.evil')
  })

  it('removes inline event handlers such as onerror', () => {
    const out = sanitizeEmailHtml('<img src="x" onerror="alert(1)">')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })

  it('neutralizes javascript: hrefs', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('neutralizes data: hrefs', () => {
    const out = sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>')
    expect(out.toLowerCase()).not.toContain('data:text/html')
  })

  it('drops <form> and its inputs', () => {
    const out = sanitizeEmailHtml(
      '<form action="https://evil.example" method="post"><input name="pw"></form>',
    )
    expect(out.toLowerCase()).not.toContain('<form')
    expect(out.toLowerCase()).not.toContain('<input')
  })

  it('drops <meta http-equiv="refresh">', () => {
    const out = sanitizeEmailHtml(
      '<meta http-equiv="refresh" content="0;url=https://evil.example"><p>hi</p>',
    )
    expect(out.toLowerCase()).not.toContain('<meta')
    expect(out.toLowerCase()).not.toContain('http-equiv')
  })

  it('drops <iframe>, <object>, <embed>, <base> and <link>', () => {
    const out = sanitizeEmailHtml(
      '<iframe src="https://evil.example"></iframe>' +
        '<object data="evil.swf"></object>' +
        '<embed src="evil.swf">' +
        '<base href="https://evil.example/">' +
        '<link rel="stylesheet" href="https://evil.example/x.css">',
    )
    for (const tag of ['<iframe', '<object', '<embed', '<base', '<link']) {
      expect(out.toLowerCase()).not.toContain(tag)
    }
  })

  it('drops image maps that could navigate the sandboxed frame itself', () => {
    const out = sanitizeEmailHtml(
      '<img src="https://cdn.example/plan.png" usemap="#plan-links">' +
        '<map name="plan-links"><area href="https://evil.example" shape="rect"></map>',
    )

    expect(out.toLowerCase()).not.toContain('<map')
    expect(out.toLowerCase()).not.toContain('<area')
    expect(out).not.toContain('https://evil.example')
  })

  it('preserves benign markup: tables, inline styles and images', () => {
    const out = sanitizeEmailHtml(
      '<table><tr><td style="color:red">A</td></tr></table>' +
        '<img src="https://cdn.example/logo.png" alt="logo">',
    )
    expect(out.toLowerCase()).toContain('<table')
    expect(out.toLowerCase()).toContain('<td')
    expect(out).toContain('color:red')
    expect(out).toContain('https://cdn.example/logo.png')
  })

  it('forces links to open safely in a new tab', () => {
    const out = sanitizeEmailHtml('<a href="https://example.com/page">link</a>')
    expect(out).toContain('href="https://example.com/page"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('returns an empty string for non-string or empty input', () => {
    expect(sanitizeEmailHtml(null)).toBe('')
    expect(sanitizeEmailHtml(undefined)).toBe('')
    expect(sanitizeEmailHtml('')).toBe('')
  })
})
