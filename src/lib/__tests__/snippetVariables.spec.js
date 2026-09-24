import { describe, expect, it } from 'vitest'

import {
  renderSnippetPreview,
  snippetFields,
  snippetRecipientValues,
  unresolvedSnippetFields,
} from '../snippetVariables'

describe('snippet variables', () => {
  it('recognizes only documented namespaced tokens and leaves ordinary braces literal', () => {
    expect(snippetFields('Hello {name} {{name}} {{recipient.company}} {{fill:}}')).toEqual([])
    expect(
      snippetFields('{{recipient.first_name}} and {{fill:meeting time}} {{fill:meeting time}}'),
    ).toEqual([
      {
        key: 'recipient.first_name',
        label: 'Recipient first name',
        token: '{{recipient.first_name}}',
      },
      { key: 'fill:meeting time', label: 'meeting time', token: '{{fill:meeting time}}' },
    ])
  })

  it('uses an exact contact match for one recipient and never invents a name from an address', () => {
    expect(snippetRecipientValues('alice@example.com', [])).toEqual({
      'recipient.email': 'alice@example.com',
      'recipient.name': '',
      'recipient.first_name': '',
    })
    expect(
      snippetRecipientValues('alice@example.com', [
        { address: 'ALICE@example.com', name: 'Alice Example' },
        { address: 'other@example.com', name: 'Wrong Person' },
      ]),
    ).toEqual({
      'recipient.email': 'alice@example.com',
      'recipient.name': 'Alice Example',
      'recipient.first_name': 'Alice',
    })
  })

  it('requests values for several recipients or conflicting matched names', () => {
    expect(
      snippetRecipientValues('alice@example.com, bob@example.com', [
        { address: 'alice@example.com', name: 'Alice Example' },
      ]),
    ).toEqual({})
    expect(
      snippetRecipientValues('alice@example.com', [
        { address: 'alice@example.com', name: 'Alice Example' },
        { address: 'alice@example.com', name: 'Alicia Example' },
      ])['recipient.name'],
    ).toBe('')
  })

  it('renders escaped values, preserves rich markup, and reports missing fields', () => {
    const rendered = renderSnippetPreview(
      '<p>Hi <strong>{{recipient.first_name}}</strong>, about {{fill:topic}}. {legacy} {{other}}</p><script>alert(1)</script>',
      { 'recipient.first_name': '<Ada & Co>' },
    )
    expect(rendered.html).toContain('<strong>&lt;Ada &amp; Co&gt;</strong>')
    expect(rendered.html).toContain('{{fill:topic}}. {legacy} {{other}}')
    expect(rendered.html).not.toContain('<script')
    expect(rendered.unresolved.map((field) => field.key)).toEqual(['fill:topic'])

    const completed = renderSnippetPreview('<p>{{fill:topic}} and {{fill:topic}}</p>', {
      'fill:topic': 'Launch <b>today</b>',
    })
    expect(completed.html).toBe(
      '<p>Launch &lt;b&gt;today&lt;/b&gt; and Launch &lt;b&gt;today&lt;/b&gt;</p>',
    )
    expect(completed.unresolved).toEqual([])
  })

  it('finds remaining recognized tokens before send without flagging legacy text', () => {
    expect(unresolvedSnippetFields('<p>{date} {{old.token}} {{fill:decision}}</p>')).toEqual([
      { key: 'fill:decision', label: 'decision', token: '{{fill:decision}}' },
    ])
  })
})
