import { describe, expect, it } from 'vitest'

import {
  buildChatGptPrompt,
  chatGptUrl,
  htmlToPromptText,
  MAX_PROMPT_BODY_CHARS,
} from '../askChatGpt'

const email = {
  sender: 'Ada Lovelace',
  address: 'ada@example.com',
  subject: 'Engine notes',
  sentAt: '2026-10-11T09:30:00Z',
  recipients: {
    to: [{ name: 'Me', address: 'me@example.com' }],
    cc: [{ name: null, address: 'charles@example.com' }],
  },
}

describe('buildChatGptPrompt', () => {
  it('leads with the headers and then the plain-text body', () => {
    const prompt = buildChatGptPrompt({
      ...email,
      text: 'First line\n\n\n\nSecond line',
      html: null,
    })
    expect(prompt).toContain('From: Ada Lovelace <ada@example.com>')
    expect(prompt).toContain('Subject: Engine notes')
    expect(prompt).toContain('To: Me <me@example.com>')
    expect(prompt).toContain('Cc: charles@example.com')
    expect(prompt.endsWith('First line\n\nSecond line')).toBe(true)
  })

  it('falls back to the text of the HTML body when there is no plain part', () => {
    const prompt = buildChatGptPrompt({
      ...email,
      text: '',
      html: '<p>Hello <strong>there</strong></p><script>alert(1)</script>',
    })
    expect(prompt).toContain('Hello there')
    expect(prompt).not.toContain('<strong>')
  })

  it('caps long bodies and says so', () => {
    const prompt = buildChatGptPrompt({ ...email, text: 'x'.repeat(MAX_PROMPT_BODY_CHARS + 500) })
    expect(prompt.endsWith('[Email truncated]')).toBe(true)
    expect(prompt.length).toBeLessThan(MAX_PROMPT_BODY_CHARS + 400)
  })

  it('omits recipient lines when the message has none', () => {
    const prompt = buildChatGptPrompt({ ...email, recipients: null, text: 'Body' })
    expect(prompt).not.toContain('To:')
    expect(prompt).not.toContain('Cc:')
  })
})

describe('htmlToPromptText', () => {
  it('keeps paragraphs and line breaks apart', () => {
    expect(htmlToPromptText('<p>Yes</p><p>No</p>')).toBe('Yes\n\nNo')
    expect(htmlToPromptText('<div>One<br>Two</div>')).toBe('One\nTwo')
    expect(htmlToPromptText('<ul><li>a</li><li>b</li></ul>')).toBe('a\n\nb')
  })

  it('collapses source whitespace but not the breaks it adds', () => {
    const html = '<div>\n  <p>\n    Hello\n    there\n  </p>\n  <p>Bye</p>\n</div>'
    expect(htmlToPromptText(html)).toBe('Hello there\n\nBye')
  })

  it('drops scripts and styles and keeps preformatted text', () => {
    const html = '<style>p{}</style><script>alert(1)</script><pre>a\n  b</pre>'
    expect(htmlToPromptText(html)).toBe('a\nb')
  })
})

describe('chatGptUrl', () => {
  it('opens chatgpt.com with the prompt prefilled', () => {
    const url = new URL(chatGptUrl('Summarise this & reply'))
    expect(url.origin).toBe('https://chatgpt.com')
    expect(url.searchParams.get('prompt')).toBe('Summarise this & reply')
  })
})
