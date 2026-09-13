// Local Performance Timeline entries, without user content or identifiers.
// Bounded by operation name so a long-lived mail tab cannot grow the buffer.
export function startTiming(name) {
  const clock = globalThis.performance
  const started = clock?.now()
  let complete = false
  return () => {
    if (complete || started === undefined || !clock?.measure) return
    complete = true
    const key = `cookie:${name}`
    try {
      clock.clearMeasures(key)
      clock.measure(key, { start: started, end: clock.now() })
    } catch {
      /* Performance instrumentation must not affect app behavior. */
    }
  }
}
