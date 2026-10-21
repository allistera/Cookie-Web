import { connectTimingRecorder } from './applicationMetrics'

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

export function connectMetrics(metrics) {
  connectTimingRecorder((operation, duration) => {
    if (!operations.has(operation)) return
    try {
      const attributes = { service: 'cookie-web', operation }
      metrics.count('web.operations', 1, { attributes })
      metrics.distribution('web.operation.duration', duration, { unit: 'millisecond', attributes })
    } catch {
      // Monitoring must never affect application behavior.
    }
  })
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
