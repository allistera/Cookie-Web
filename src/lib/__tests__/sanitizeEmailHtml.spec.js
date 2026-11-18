import { describe, it, expect } from 'vitest'

import {
  sanitizeEmailHtml,
  sanitizeEmailHtmlForReader,
  sanitizeForwardedEmailHtml,
} from '../sanitizeEmailHtml'

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

  it('keeps the whole body style when it contains quotes', () => {
    const out = sanitizeEmailHtml(
      `<body style='font-family: "Helvetica Neue", sans-serif; background:#000'><p>hi</p></body>`,
    )
    const wrapper = new DOMParser().parseFromString(out, 'text/html').body.firstElementChild
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.getAttribute('style')).toContain('"Helvetica Neue"')
    expect(wrapper.getAttribute('style')).toContain('background:#000')
    expect(wrapper.innerHTML).toBe('<p>hi</p>')
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

describe('sanitizeEmailHtmlForReader', () => {
  // Marketing mail keeps its class rules in <head>. Sanitizing returns only
  // the body, so without carrying the sheets across the reader shows the bare
  // markup: preheaders visible, both the desktop and mobile images, no layout.
  it('keeps style sheets declared in <head>', () => {
    const out = sanitizeEmailHtmlForReader(
      '<!doctype html><html><head><title>t</title>' +
        '<style>.preheader{display:none}</style><style>.card{max-width:720px}</style>' +
        '</head><body><div class="preheader">Preview</div><p class="card">hi</p></body></html>',
    )
    expect(out).toBe(
      '<style>.preheader{display:none}</style><style>.card{max-width:720px}</style>' +
        '<div class="preheader">Preview</div><p class="card">hi</p>',
    )
  })

  it('keeps a style sheet that opens a message with no <head> of its own', () => {
    expect(sanitizeEmailHtmlForReader('<style>.a{color:red}</style><p class="a">hi</p>')).toBe(
      '<style>.a{color:red}</style><p class="a">hi</p>',
    )
  })

  it('keeps a head style sheet wrapped in an HTML comment, as Outlook writes it', () => {
    const out = sanitizeEmailHtmlForReader(
      '<html><head><style><!--\np.MsoNormal{margin:0cm}\n--></style></head>' +
        '<body><p class="MsoNormal">hi</p></body></html>',
    )
    expect(out).toContain('p.MsoNormal{margin:0cm}')
    expect(out).not.toContain('<!--')
    expect(out).toContain('<p class="MsoNormal">hi</p>')
  })

  it('puts head style sheets ahead of the wrapper that carries the body background', () => {
    const out = sanitizeEmailHtmlForReader(
      '<head><style>.a{color:#fff}</style></head><body bgcolor="#000000"><p class="a">hi</p></body>',
    )
    expect(out).toBe(
      '<style>.a{color:#fff}</style>' +
        '<div style="background-color: #000000;"><p class="a">hi</p></div>',
    )
  })

  it('carries nothing else out of <head>', () => {
    const out = sanitizeEmailHtmlForReader(
      '<head><style>.a{color:red}</style><script>window.evil = 1</script>' +
        '<link rel="stylesheet" href="https://evil.example/x.css">' +
        '<meta http-equiv="refresh" content="0;url=https://evil.example">' +
        '<base href="https://evil.example/"><title>t</title></head><body><p>hi</p></body>',
    )
    expect(out).toBe('<style>.a{color:red}</style><p>hi</p>')
  })

  it('drops a head style sheet that hides markup', () => {
    const out = sanitizeEmailHtmlForReader(
      '<head><style><img src=x onerror=alert(1)></style></head><body><p>hi</p></body>',
    )
    expect(out).toBe('<p>hi</p>')
  })

  // The composer edits in the app's own page, where a carried sheet would
  // restyle the app itself.
  it('leaves head style sheets out of content bound for the composer', () => {
    const out = sanitizeEmailHtml(
      '<head><style>body{font-family:Calibri}</style></head><body><p>hi</p></body>',
    )
    expect(out).toBe('<p>hi</p>')
  })

  it('still strips every style sheet from a forwarded body', () => {
    const out = sanitizeForwardedEmailHtml(
      '<head><style>.a{color:red}</style></head><body><p class="a">hi</p></body>',
    )
    expect(out).toBe('<p>hi</p>')
  })

  it('sanitizes the body as sanitizeEmailHtml does', () => {
    const out = sanitizeEmailHtmlForReader(
      '<body style="background:#000" onload="window.evil = 1"><p>hi</p>' +
        '<script>window.evil = 1</script><a href="https://example.com/page">link</a></body>',
    )
    expect(out).toContain('<div style="background:#000">')
    expect(out).not.toContain('window.evil')
    expect(out.toLowerCase()).not.toContain('onload')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('returns an empty string for empty input', () => {
    expect(sanitizeEmailHtmlForReader(null)).toBe('')
    expect(sanitizeEmailHtmlForReader('')).toBe('')
  })
})
