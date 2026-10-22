import { describe, expect, it } from 'vitest'
import { parseComposePreferences } from '../composePreferences'

describe('API composer preferences', () => {
  it('sanitizes remote HTML before it enters the editor or slash menu', () => {
    const result = parseComposePreferences({
      revision: 2,
      signatureHtml: '<p>Hi<script>alert(1)</script></p>',
      snippets: [
        { id: 'one', name: 'Hello World', html: '<img src=x onerror="alert(1)"><p>Welcome</p>' },
      ],
    })
    expect(result.signatureHtml).toBe('<p>Hi</p>')
    expect(result.snippets[0]).toMatchObject({ id: 'one', name: 'hello-world' })
    expect(result.snippets[0].html).not.toContain('onerror')
    expect(result.snippets[0].html).toContain('<p>Welcome</p>')
  })

  it('refuses a response without a valid revision', () => {
    expect(() => parseComposePreferences({ signatureHtml: '', snippets: [] })).toThrow(
      'Invalid composer preferences response',
    )
  })

  it.each([null, undefined, { revision: -1 }, { revision: 1.5 }, { revision: Infinity }])(
    'rejects missing or invalid revision data: %j',
    (value) => {
      expect(() => parseComposePreferences(value)).toThrow('Invalid composer preferences response')
    },
  )

  it('accepts the initial revision with empty preferences', () => {
    expect(parseComposePreferences({ revision: 0, signatureHtml: '', snippets: [] })).toEqual({
      revision: 0,
      signatureHtml: '',
      snippets: [],
    })
  })
})
