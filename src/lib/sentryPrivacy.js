const errorTypes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
])
const debugIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu

// Only deployed app assets provide useful stack locations without exposing
// mailbox routes, URL tokens, eval source, local variables, or source snippets.
function sanitizeFrame(frame) {
  try {
    const url = new URL(frame.filename, window.location.origin)
    if (url.origin !== window.location.origin || !/^\/assets\/[\w.-]+\.js$/u.test(url.pathname)) {
      return null
    }
    const sanitized = { filename: `${url.origin}${url.pathname}` }
    if (Number.isInteger(frame.lineno)) sanitized.lineno = frame.lineno
    if (Number.isInteger(frame.colno)) sanitized.colno = frame.colno
    if (debugIdPattern.test(frame.debug_id)) sanitized.debug_id = frame.debug_id
    return sanitized
  } catch {
    return null
  }
}

// Allowlist the outgoing shape: arbitrary exception messages, contexts, extras,
// tags, fingerprints and nested exception/frame fields can all contain mail.
export function sanitizeEvent(event) {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: 'error',
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tags: { service: 'cookie-web' },
    debug_meta: {
      images: (event.debug_meta?.images ?? []).flatMap((image) => {
        const frame = sanitizeFrame({ filename: image.code_file })
        if (image.type !== 'sourcemap' || !frame || !debugIdPattern.test(image.debug_id)) return []
        return [{ type: 'sourcemap', code_file: frame.filename, debug_id: image.debug_id }]
      }),
    },
    exception: {
      values: (event.exception?.values ?? [{}]).map((exception) => ({
        type: errorTypes.has(exception.type) ? exception.type : 'Error',
        value: '[Redacted]',
        stacktrace: {
          frames: (exception.stacktrace?.frames ?? []).map(sanitizeFrame).filter(Boolean),
        },
      })),
    },
  }
}

const routeNames = new Set([
  'ai-inbox',
  'traditional-inbox',
  'calendar',
  'drafts',
  'scheduled-sends',
  'document-file',
  'documents',
  'search',
  'tasks',
  'settings',
])
const operations = new Set([
  'pageload',
  'navigation',
  'http.client',
  'resource.script',
  'resource.css',
  'resource.img',
  'resource.link',
  'resource.other',
  'ui.long-task',
  'ui.webvital.lcp',
  'ui.webvital.cls',
  'ui.interaction.click',
  'ui.interaction.hover',
  'ui.interaction.drag',
  'ui.interaction.press',
  'ui.interaction',
  'browser',
])
const numericAttributes = new Set([
  'http.response.status_code',
  'http.response_content_length',
  'browser.web_vital.lcp.value',
  'browser.web_vital.cls.value',
  'browser.web_vital.inp.value',
  'browser.web_vital.fcp.value',
  'browser.web_vital.fp.value',
  'browser.web_vital.ttfb.value',
  'browser.web_vital.ttfb.request_time',
  'sentry.exclusive_time',
])

export function sanitizeSpanStart(options) {
  return { ...options, name: routeNames.has(options.name) ? options.name : 'web' }
}

// v11 streams spans separately from error events; beforeSend does not sanitize
// them. Keep timing and numeric Web Vitals, never URLs, DOM text, or span links.
export function sanitizeSpan(span) {
  const source = span.attributes ?? {}
  const op = operations.has(source['sentry.op']) ? source['sentry.op'] : 'browser'
  const name = routeNames.has(span.name) ? span.name : op
  const attributes = {
    'sentry.op': op,
    'sentry.segment.name': routeNames.has(source['sentry.segment.name'])
      ? source['sentry.segment.name']
      : 'web',
    'service.name': 'cookie-web',
    'sentry.environment': import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    'sentry.release': import.meta.env.VITE_SENTRY_RELEASE || undefined,
    'sentry.trace_lifecycle': 'stream',
  }
  for (const key of ['sentry.segment.id', 'sentry.pageload.span_id']) {
    if (/^[0-9a-f]{16}$/iu.test(source[key])) attributes[key] = source[key]
  }
  for (const key of numericAttributes) {
    if (Number.isFinite(source[key])) {
      attributes[key] = source[key]
    }
  }
  return {
    trace_id: span.trace_id,
    parent_span_id: span.parent_span_id,
    span_id: span.span_id,
    name,
    start_timestamp: span.start_timestamp,
    end_timestamp: span.end_timestamp,
    status: span.status,
    is_segment: span.is_segment,
    attributes,
  }
}

// Keep SDK configuration in the lazy monitoring chunk, outside app startup.
export function createSentryOptions(
  app,
  dsn,
  { browserTracingIntegration, browserProfilingIntegration },
) {
  return {
    app,
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    attachProps: false,
    integrations: [
      browserTracingIntegration({
        router: app.config.globalProperties?.$router,
        beforeStartSpan: sanitizeSpanStart,
      }),
      browserProfilingIntegration(),
    ],
    tracesSampleRate: 0.1,
    profileSessionSampleRate: 0.1,
    profileLifecycle: 'trace',
    // Observe request timings without forwarding tracing headers to APIs.
    tracePropagationTargets: [],
    // Sentry 11 collects these categories by default. Mailbox content and
    // authentication data must not become diagnostic context.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend: sanitizeEvent,
    beforeSendSpan: sanitizeSpan,
  }
}
