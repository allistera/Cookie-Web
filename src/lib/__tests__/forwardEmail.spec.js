import { describe, expect, it } from 'vitest'

import { buildForwardDraft, forwardSubject } from '../forwardEmail'

describe('forwardSubject', () => {
  it('adds one forward prefix without stacking another existing prefix', () => {
    expect(forwardSubject('Quarterly plan')).toBe('Fwd: Quarterly plan')
    expect(forwardSubject('Fwd: Quarterly plan')).toBe('Fwd: Quarterly plan')
    expect(forwardSubject('FW: Quarterly plan')).toBe('FW: Quarterly plan')
  })
})

describe('buildForwardDraft', () => {
  const message = {
    sender: 'Alex & Co',
    address: 'alex@example.com',
    subject: 'Quarterly <plan>',
    sentAt: '2026-09-01T10:30:00.000Z',
    text: 'Hello team\nSecond line',
  }

  it('quotes the original body and includes readable original-message headers', () => {
    const draft = buildForwardDraft(message)

    expect(draft.text).toContain('---------- Forwarded message ----------')
    expect(draft.text).toContain('From: Alex & Co <alex@example.com>')
    expect(draft.text).toContain('Subject: Quarterly <plan>')
    expect(draft.text).toContain('> Hello team\n> Second line')
    expect(draft.html).toContain('<blockquote>')
    expect(draft.html).toContain('<p>Hello team<br>Second line</p>')
    expect(draft.html).toContain('Alex &amp; Co &lt;alex@example.com&gt;')
    expect(draft.html).toContain('Quarterly &lt;plan&gt;')
  })

  it('sanitizes hostile original HTML before placing it in the quote', () => {
    const draft = buildForwardDraft({
      ...message,
      html: `<p class="app-shell" style="position:fixed">Hello <strong>team</strong></p>
        <script>alert(1)</script><img src="https://tracker.example/open" onerror=x>`,
    })

    expect(draft.html).toContain('<p>Hello <strong>team</strong></p>')
    expect(draft.html).not.toMatch(/script|onerror|position:fixed|tracker\.example|app-shell/i)
  })
})
