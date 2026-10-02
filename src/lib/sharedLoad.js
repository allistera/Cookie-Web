// Shares one in-flight load per owner (a store instance, or any object), so
// components mounting together send one request between them.
//
// A forced load is different: whoever forces wants data newer than some
// change they just made, and a request already in flight may have been sent
// before it. So a forced call made while a load is in flight queues exactly
// one fresh load after it, shared by every forced caller meanwhile. Unforced
// callers just join whatever is in flight.
//
// Each call resolves with the load's own result.
export function createSharedLoad() {
  const states = new WeakMap()

  function stateFor(owner) {
    let state = states.get(owner)
    if (!state) {
      state = { inFlight: null, queued: null, abandoned: false }
      states.set(owner, state)
    }
    return state
  }

  function sharedLoad(owner, load, { force = false } = {}) {
    const state = stateFor(owner)
    if (state.inFlight) {
      if (!force) return state.inFlight
      state.queued ??= state.inFlight
        .catch(() => {})
        .then(() => {
          if (state.abandoned) return false
          state.queued = null
          return sharedLoad(owner, load, { force: true })
        })
      return state.queued
    }
    const run = (async () => {
      try {
        return await load()
      } finally {
        if (state.inFlight === run) state.inFlight = null
      }
    })()
    state.inFlight = run
    return run
  }

  // The load a caller would end up waiting on (a queued forced reload, else
  // the one in flight), or null; for actions that must run after any load.
  sharedLoad.current = (owner) => {
    const state = states.get(owner)
    return state?.queued ?? state?.inFlight ?? null
  }

  // Forgets the owner's loads: the next call starts fresh, and a queued
  // forced reload is dropped (it resolves false) rather than run.
  sharedLoad.reset = (owner) => {
    const state = states.get(owner)
    if (state) state.abandoned = true
    states.delete(owner)
  }

  return sharedLoad
}
