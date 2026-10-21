// Keep this bridge SDK-free so monitoring stays outside the entry bundle.
const operations = new Set([
  'route-ready',
  'reader-ready',
  'message-body',
  'search',
  ...['documents', 'task-items', 'request'].flatMap((resource) =>
    ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].map(
      (method) => `${resource}:${method}`,
    ),
  ),
])
const pending = []
let recorder

export function recordTiming(operation, duration) {
  if (
    !import.meta.env.PROD ||
    import.meta.env.VITE_E2E === 'true' ||
    !import.meta.env.VITE_SENTRY_DSN ||
    !operations.has(operation) ||
    !Number.isFinite(duration) ||
    duration < 0
  )
    return
  if (recorder) recorder(operation, duration)
  else if (pending.length < 100) pending.push([operation, duration])
}

export function connectMetrics(metrics) {
  recorder = (operation, duration) => {
    try {
      const attributes = { service: 'cookie-web', operation }
      metrics.count('web.operations', 1, { attributes })
      metrics.distribution('web.operation.duration', duration, { unit: 'millisecond', attributes })
    } catch {
      // Monitoring must never affect application behavior.
    }
  }
  for (const [operation, duration] of pending.splice(0)) recorder(operation, duration)
}

export function sanitizeMetric(metric) {
  if (
    !['web.operations', 'web.operation.duration'].includes(metric.name) ||
    !operations.has(metric.attributes?.operation) ||
    !Number.isFinite(metric.value) ||
    metric.value < 0
  )
    return null
  const sanitized = {
    name: metric.name,
    value: metric.value,
    type: metric.name === 'web.operations' ? 'counter' : 'distribution',
    attributes: { service: 'cookie-web', operation: metric.attributes.operation },
  }
  if (metric.name === 'web.operation.duration') sanitized.unit = 'millisecond'
  return sanitized
}
