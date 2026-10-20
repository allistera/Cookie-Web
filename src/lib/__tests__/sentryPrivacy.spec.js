import { describe, expect, it } from 'vitest'
import { sanitizeEvent, sanitizeSpan, sanitizeSpanStart } from '../sentryPrivacy'

describe('Sentry payload privacy', () => {
  it('normalizes root names before sampling metadata is created', () => {
    expect(sanitizeSpanStart({ name: '/documents/private?token=secret', op: 'pageload' })).toEqual({
      name: 'web',
      op: 'pageload',
    })
    expect(sanitizeSpanStart({ name: 'calendar', op: 'navigation' }).name).toBe('calendar')
  })
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

  it('retains safe source-map debug IDs without diagnostic payloads', () => {
    const debugId = '12345678-1234-1234-1234-123456789abc'
    const filtered = sanitizeEvent({
      debug_meta: {
        images: [
          {
            type: 'sourcemap',
            debug_id: debugId,
            code_file: `${window.location.origin}/assets/app-abc.js?token=secret`,
            private: 'mail content',
          },
          { type: 'sourcemap', debug_id: debugId, code_file: 'https://external.example/mail' },
        ],
      },
    })
    expect(filtered.debug_meta.images).toEqual([
      {
        type: 'sourcemap',
        debug_id: debugId,
        code_file: `${window.location.origin}/assets/app-abc.js`,
      },
    ])
  })

  it('keeps span timings and Web Vitals while removing URLs, DOM text and arbitrary attributes', () => {
    const span = {
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      parent_span_id: 'c'.repeat(16),
      start_timestamp: 10,
      end_timestamp: 11,
      is_segment: false,
      status: 'ok',
      name: 'GET https://example.com/mail/private?token=secret',
      links: [{ attributes: { subject: 'private' } }],
      attributes: {
        'sentry.op': 'http.client',
        'http.response.status_code': 200,
        'url.full': 'https://example.com/private',
        'browser.web_vital.lcp.value': 123,
        'browser.web_vital.lcp.element': '<div>private</div>',
        'sentry.segment.name': '/documents/private',
        'sentry.segment.id': 'd'.repeat(16),
        'custom.mail': 'private',
      },
    }
    const filtered = sanitizeSpan(span)
    expect(filtered).toMatchObject({
      trace_id: span.trace_id,
      span_id: span.span_id,
      parent_span_id: span.parent_span_id,
      start_timestamp: 10,
      end_timestamp: 11,
      name: 'http.client',
      attributes: {
        'http.response.status_code': 200,
        'browser.web_vital.lcp.value': 123,
        'sentry.segment.id': 'd'.repeat(16),
        'sentry.segment.name': 'web',
      },
    })
    expect(JSON.stringify(filtered)).not.toContain('private')
    expect(JSON.stringify(filtered)).not.toContain('secret')
    expect(sanitizeSpan({ ...span, name: 'calendar' }).name).toBe('calendar')
  })
})
