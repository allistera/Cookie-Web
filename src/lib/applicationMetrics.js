// Keep this bridge SDK-free so monitoring stays outside the entry bundle.
const pending = []
let recorder

export function recordTiming(operation, duration) {
  if (
    !import.meta.env.PROD ||
    import.meta.env.VITE_E2E === 'true' ||
    !import.meta.env.VITE_SENTRY_DSN ||
    !Number.isFinite(duration) ||
    duration < 0
  )
    return
  if (recorder) recorder(operation, duration)
  else if (pending.length < 100) pending.push([operation, duration])
}

export function connectTimingRecorder(emit) {
  recorder = emit
  for (const [operation, duration] of pending.splice(0)) recorder(operation, duration)
}
