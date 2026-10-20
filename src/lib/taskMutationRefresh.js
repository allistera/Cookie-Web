// History observes successful writes, not list reads. A bulk operation emits
// one refresh after all of its writes settle, including partial success.
export function subscribeTaskMutations(store, refresh) {
  let batches = 0
  let dirty = false
  let queued = false
  let disposed = false
  function flush() {
    if (disposed || batches || !dirty || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (disposed || batches || !dirty) return
      dirty = false
      refresh()
    })
  }
  const unsubscribe = store.$onAction(({ name, args, after, onError }) => {
    if (['editItems', 'deleteItems', 'moveItems'].includes(name)) {
      batches++
      const finish = () => {
        batches--
        flush()
      }
      after(finish)
      onError(finish)
    } else if (
      name === 'invalidateHistory' ||
      (name === 'request' && !['GET', 'HEAD'].includes(String(args[0]).toUpperCase()))
    ) {
      after(() => {
        dirty = true
        flush()
      })
    }
  })
  return () => {
    disposed = true
    unsubscribe()
  }
}
