// Coalesces Editor.js's per-mutation events into one trailing serialization.
// A second burst that arrives during a slow save is remembered and runs once
// the in-flight work finishes, so serializations never overlap.
export function createDocumentSaveScheduler(save, delay = 300) {
  let timer = null
  let inFlight = null
  let dirty = false
  let canceled = false

  function clearTimer() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  async function flush() {
    clearTimer()
    if (canceled) return

    if (inFlight) {
      await inFlight
      return dirty ? flush() : undefined
    }
    if (!dirty) return

    dirty = false
    const task = Promise.resolve().then(save)
    inFlight = task
    try {
      await task
    } finally {
      if (inFlight === task) inFlight = null
    }

    if (dirty && !canceled) return flush()
  }

  function schedule() {
    if (canceled) return
    dirty = true
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      if (!inFlight) void flush()
    }, delay)
  }

  function cancel() {
    canceled = true
    dirty = false
    clearTimer()
  }

  return { cancel, flush, schedule }
}
