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
