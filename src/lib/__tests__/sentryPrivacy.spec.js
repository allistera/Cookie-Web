import { describe, expect, it } from 'vitest'
import { sanitizeEvent } from '../sentryPrivacy'

describe('Sentry payload privacy', () => {
  it('removes mail from free-form and nested fields while preserving asset stack locations', () => {
    const privateText = 'Private mailbox subject and body'
    const event = {
      event_id: 'a'.repeat(32),
      timestamp: 123,
      message: privateText,
      logentry: { message: privateText },
      extra: { body: privateText },
      contexts: { vue: { props: privateText } },
      user: { email: privateText },
      request: { url: privateText },
      breadcrumbs: [{ message: privateText }],
      tags: { subject: privateText },
      fingerprint: [privateText],
      transaction: privateText,
      exception: {
        values: [
          {
            type: 'TypeError',
            value: privateText,
            mechanism: { data: { body: privateText } },
            stacktrace: {
              frames: [
                {
                  filename: `${window.location.origin}/assets/app-abc.js?token=secret#private`,
                  lineno: 12,
                  colno: 34,
                  function: privateText,
                  vars: { body: privateText },
                  context_line: privateText,
                  pre_context: [privateText],
                  post_context: [privateText],
                  abs_path: privateText,
                },
                { filename: `${window.location.origin}/mail/private` },
                { filename: 'https://external.example/assets/private.js' },
                { filename: `data:text/javascript,${privateText}` },
              ],
            },
          },
          { type: privateText, value: privateText },
        ],
      },
    }
    const filtered = sanitizeEvent(event)
    expect(filtered.exception.values).toEqual([
      {
        type: 'TypeError',
        value: '[Redacted]',
        stacktrace: {
          frames: [
            {
              filename: `${window.location.origin}/assets/app-abc.js`,
              lineno: 12,
              colno: 34,
            },
          ],
        },
      },
      { type: 'Error', value: '[Redacted]', stacktrace: { frames: [] } },
    ])
    expect(filtered.event_id).toBe(event.event_id)
    expect(filtered.timestamp).toBe(123)
    expect(filtered.tags).toEqual({ service: 'cookie-web' })
    expect(JSON.stringify(filtered)).not.toContain(privateText)
    expect(JSON.stringify(filtered)).not.toContain('secret')
  })

  it('redacts events without an exception, including non-Error throws', () => {
    const filtered = sanitizeEvent({ message: 'private mail', extra: { value: 'private mail' } })
    expect(filtered.exception.values).toEqual([
      { type: 'Error', value: '[Redacted]', stacktrace: { frames: [] } },
    ])
    expect(JSON.stringify(filtered)).not.toContain('private mail')
  })
})
