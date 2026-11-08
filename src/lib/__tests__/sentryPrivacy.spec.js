import { afterEach, describe, expect, it } from 'vitest'
import {
  sanitizeEvent,
  sanitizeRecordingEvent,
  sanitizeReplayEvent,
  sanitizeSpan,
  sanitizeSpanStart,
} from '../sentryPrivacy'
import { RELOAD_KEY } from '../staleChunkReload'

describe('Sentry payload privacy', () => {
  it('keeps the IDs and thread metadata needed to link spans to profile chunks', () => {
    const profilerId = 'a'.repeat(32)
    const profileId = 'b'.repeat(32)
    const span = sanitizeSpan({
      attributes: {
        'sentry.profiler_id': profilerId,
        'sentry.profile_id': profileId,
        'thread.id': '0',
        'thread.name': 'main',
        'user.email': 'private@example.com',
        'url.full': 'https://example.com/private',
      },
    })
    expect(span.attributes).toMatchObject({
      'sentry.profiler_id': profilerId,
      'sentry.profile_id': profileId,
      'thread.id': '0',
      'thread.name': 'main',
    })
    expect(JSON.stringify(span)).not.toContain('private')
  })

  it.each(['private', '', null, 123, { private: 'mail' }])(
    'drops malformed profiling metadata %j',
    (value) => {
      const { attributes } = sanitizeSpan({
        attributes: {
          'sentry.profiler_id': value,
          'sentry.profile_id': value,
          'thread.id': value,
          'thread.name': value,
        },
      })
      for (const key of ['sentry.profiler_id', 'sentry.profile_id', 'thread.id', 'thread.name']) {
        expect(Object.hasOwn(attributes, key)).toBe(false)
      }
    },
  )

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

  describe('while a stale-chunk reload is pending', () => {
    afterEach(() => sessionStorage.removeItem(RELOAD_KEY))

    const unresolved = () => new Error('Couldn\'t resolve component "default" at "/tasks"')
    const event = (error) => ({ exception: { values: [{ type: 'Error', value: error.message }] } })

    // COOKIE-WEB-1K: the import that triggered the reload is not a defect.
    it('drops the chunk-load error that started it', () => {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      expect(sanitizeEvent(event(unresolved()), { originalException: unresolved() })).toBeNull()
      expect(sanitizeEvent(event(unresolved()))).toBeNull()
    })

    it('keeps other errors, and chunk-load errors with no reload pending', () => {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      expect(sanitizeEvent(event(new Error('private mail')))).not.toBeNull()
      sessionStorage.removeItem(RELOAD_KEY)
      expect(sanitizeEvent(event(unresolved()), { originalException: unresolved() })).not.toBeNull()
    })
  })

  it('redacts events without an exception, including non-Error throws', () => {
    const filtered = sanitizeEvent({ message: 'private mail', extra: { value: 'private mail' } })
    expect(filtered.exception.values).toEqual([
      { type: 'Error', value: '[Redacted]', stacktrace: { frames: [] } },
    ])
    expect(JSON.stringify(filtered)).not.toContain('private mail')
  })

  it('keeps only a well-formed replay session id among the tags', () => {
    const replayId = 'c'.repeat(32)
    expect(sanitizeEvent({ tags: { replayId, subject: 'private mail' } }).tags).toEqual({
      service: 'cookie-web',
      replayId,
    })
    expect(sanitizeEvent({ tags: { replayId: 'private mail' } }).tags).toEqual({
      service: 'cookie-web',
    })
  })

  it('removes URLs from replay recordings while keeping interactions and timings', () => {
    const url = `${window.location.origin}/mail/private?token=secret`
    const meta = sanitizeRecordingEvent({ type: 4, data: { href: url, width: 1, height: 2 } })
    expect(meta).toEqual({
      type: 4,
      data: { href: `${window.location.origin}/`, width: 1, height: 2 },
    })
    const span = sanitizeRecordingEvent({
      type: 5,
      timestamp: 1,
      data: {
        tag: 'performanceSpan',
        payload: {
          op: 'navigation.push',
          description: url,
          startTimestamp: 1,
          endTimestamp: 2,
          data: { size: 10 },
        },
      },
    })
    expect(span.data.payload).toEqual({
      op: 'navigation.push',
      description: 'navigation.push',
      startTimestamp: 1,
      endTimestamp: 2,
      data: { size: 10 },
    })
    const breadcrumb = (category, data, message) =>
      sanitizeRecordingEvent({
        type: 5,
        timestamp: 3,
        data: {
          tag: 'breadcrumb',
          payload: { type: 'default', timestamp: 3, category, message, data },
        },
      })
    expect(breadcrumb('fetch', { method: 'GET', statusCode: 200, url })).toEqual({
      type: 5,
      timestamp: 3,
      data: {
        tag: 'breadcrumb',
        payload: {
          type: 'default',
          timestamp: 3,
          category: 'fetch',
          message: undefined,
          data: { method: 'GET', statusCode: 200 },
        },
      },
    })
    expect(breadcrumb('navigation', { from: url, to: url }).data.payload.data).toEqual({})
    const slowClick = breadcrumb(
      'ui.slowClickDetected',
      { url, route: 'private', clickCount: 2, endReason: 'timeout', timeAfterClickMs: 3000 },
      'button.btn',
    )
    expect(slowClick.data.payload).toMatchObject({
      message: 'button.btn',
      data: { clickCount: 2, endReason: 'timeout', timeAfterClickMs: 3000 },
    })
    expect(breadcrumb('console', { arguments: ['private mail'] })).toBeNull()
    const domEvent = { type: 3, data: { source: 0, adds: [] } }
    expect(sanitizeRecordingEvent(domEvent)).toBe(domEvent)
    for (const filtered of [meta, span, slowClick]) {
      expect(JSON.stringify(filtered)).not.toContain('private')
      expect(JSON.stringify(filtered)).not.toContain('secret')
    }
  })

  it('reduces replay segments to identifiers and route names', () => {
    const url = `${window.location.origin}/mail/private?token=secret`
    const event = {
      type: 'replay_event',
      event_id: 'a'.repeat(32),
      replay_id: 'a'.repeat(32),
      segment_id: 2,
      replay_type: 'buffer',
      replay_start_timestamp: 1,
      timestamp: 2,
      error_ids: ['b'.repeat(32)],
      trace_ids: ['c'.repeat(32)],
      segment_names: ['calendar', '/documents/private'],
      urls: [url],
      request: { url, headers: { 'User-Agent': 'private' } },
      user: { email: 'private@example.com' },
      contexts: { trace: { data: { subject: 'private' } } },
      breadcrumbs: [{ message: 'private' }],
      tags: { subject: 'private' },
    }
    const filtered = sanitizeReplayEvent(event)
    expect(filtered).toEqual({
      type: 'replay_event',
      event_id: event.event_id,
      replay_id: event.replay_id,
      segment_id: 2,
      replay_type: 'buffer',
      replay_start_timestamp: 1,
      timestamp: 2,
      error_ids: event.error_ids,
      trace_ids: event.trace_ids,
      segment_names: ['calendar'],
      urls: [],
      platform: 'javascript',
      environment: 'production',
      release: undefined,
      tags: { service: 'cookie-web' },
    })
    const errorEvent = { exception: { values: [] }, request: { url } }
    expect(sanitizeReplayEvent(errorEvent)).toBe(errorEvent)
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
