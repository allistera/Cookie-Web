import { sanitizeMetric } from './sentryMetrics'
import { isChunkLoadError, isReloadingForStaleChunk } from './staleChunkReload'

export const SENTRY_TUNNEL_PATH = '/monitoring'

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
const replayIdPattern = /^[0-9a-f]{32}$/iu

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
export function sanitizeEvent(event, hint) {
  // A deploy left this tab with stale chunk URLs and a reload is already on
  // its way (staleChunkReload, router/chunkReload). The failed import, and
  // the unresolved route component vue-router raises from it, are not
  // defects (COOKIE-WEB-1K). A chunk missing for any other reason, with no
  // reload pending, still reports.
  const error = hint?.originalException ?? event.exception?.values?.[0]?.value
  if (isChunkLoadError(error) && isReloadingForStaleChunk()) return null
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: 'error',
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    // The replay integration tags error events with its session id. Sentry
    // links the issue to the replay through it, and the SDK only uploads an
    // error-sampled buffer when the tag survives beforeSend.
    tags: replayIdPattern.test(event.tags?.replayId)
      ? { service: 'cookie-web', replayId: event.tags.replayId }
      : { service: 'cookie-web' },
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

// rrweb masks text, inputs and media while it records. Its Meta event and the
// custom breadcrumb and performance payloads are not masked and carry page,
// API and navigation URLs that would reveal which mailbox routes were opened.
const rrwebMetaEvent = 4
const recordingBreadcrumbs = new Set([
  'navigation',
  'fetch',
  'xhr',
  'ui.click',
  'ui.input',
  'ui.keyDown',
  'ui.blur',
  'ui.focus',
  'ui.multiClick',
  'ui.slowClickDetected',
  'replay.mutations',
  'replay.hydrate-error',
])
const recordingDataKeys = new Set([
  'nodeId',
  'node',
  'method',
  'statusCode',
  'request_body_size',
  'response_body_size',
  'clickCount',
  'endReason',
  'timeAfterClickMs',
  'count',
  'limit',
  'key',
  'metaKey',
  'ctrlKey',
  'altKey',
  'shiftKey',
])

export function sanitizeRecordingEvent(event) {
  if (event.type === rrwebMetaEvent) {
    return { ...event, data: { ...event.data, href: `${window.location.origin}/` } }
  }
  const { tag, payload } = event.data ?? {}
  if (tag === 'performanceSpan') {
    return { ...event, data: { tag, payload: { ...payload, description: payload.op } } }
  }
  if (tag !== 'breadcrumb') return event
  if (!recordingBreadcrumbs.has(payload.category)) return null
  const data = {}
  for (const key of recordingDataKeys) {
    if (Object.hasOwn(payload.data ?? {}, key)) data[key] = payload.data[key]
  }
  return {
    ...event,
    data: {
      tag,
      payload: {
        type: 'default',
        timestamp: payload.timestamp,
        category: payload.category,
        message: payload.message,
        data,
      },
    },
  }
}

// Replay segments are prepared outside beforeSend. Keep the identifiers that
// stitch segments, errors and traces together; drop the page URLs, request
// context and anything else the scope attached.
export function sanitizeReplayEvent(event) {
  if (event.type !== 'replay_event') return event
  return {
    type: 'replay_event',
    event_id: event.event_id,
    replay_id: event.replay_id,
    segment_id: event.segment_id,
    replay_type: event.replay_type,
    replay_start_timestamp: event.replay_start_timestamp,
    timestamp: event.timestamp,
    error_ids: event.error_ids,
    trace_ids: event.trace_ids,
    segment_names: (event.segment_names ?? []).filter((name) => routeNames.has(name)),
    urls: [],
    platform: 'javascript',
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tags: { service: 'cookie-web' },
  }
}

// Keep SDK configuration in the lazy monitoring chunk, outside app startup.
export function createSentryOptions(app, dsn, { browserTracingIntegration, replayIntegration }) {
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
      // Session Replay records a masked DOM: text and inputs become asterisks,
      // media is blocked and the sandboxed mail iframe is a blank box. Request
      // and response bodies and headers stay off (no networkDetailAllowUrls).
      replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        maskAttributes: ['title', 'placeholder', 'aria-label', 'alt'],
        block: ['.ni-email-frame'],
        beforeAddRecordingEvent: sanitizeRecordingEvent,
      }),
      { name: 'ReplayPrivacy', processEvent: sanitizeReplayEvent },
    ],
    tracesSampleRate: 0.1,
    // The Developer plan includes 50 replays a month and drops the rest, so a
    // low session rate keeps the quota for the replays attached to errors.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    // Browser profiling is off: Sentry bills UI profile hours only through a
    // pay-as-you-go budget, so every profile chunk was rejected with a 429.
    // Same-origin path that vercel.json proxies to the Sentry envelope
    // endpoint, so ad and privacy blockers do not drop telemetry.
    tunnel: SENTRY_TUNNEL_PATH,
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
    beforeSendMetric: sanitizeMetric,
    beforeSend: sanitizeEvent,
    beforeSendSpan: sanitizeSpan,
  }
}
