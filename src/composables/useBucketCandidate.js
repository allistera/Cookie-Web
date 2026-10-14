import { onScopeDispose, watch } from 'vue'

import { useBucketsStore } from '../stores/buckets'
import { useInboxStore } from '../stores/inbox'

let nextToken = 0

// Registers what the calling view has open as the thing 'b' would pin.
// `source` returns a bucket item (lib/bucketItems.js) or null; it is watched
// so a renamed document or a closed reader updates the candidate. Leaving
// the view clears only its own registration.
export function useBucketCandidate(source) {
  const store = useBucketsStore()
  const token = `candidate-${++nextToken}`
  watch(
    source,
    (item) => {
      if (item) store.setCandidate(token, item)
      else store.clearCandidate(token)
    },
    { immediate: true, deep: true },
  )
  onScopeDispose(() => store.clearCandidate(token))
}

// Pins an item (the candidate unless one is given), or unpins it when it is
// already in the bucket, and says so in a toast whose Undo reverses it.
export function useBucketPin() {
  const store = useBucketsStore()
  const inbox = useInboxStore()
  return function pin(item = store.candidate) {
    const result = store.togglePin(item)
    if (!result) return null
    const undo = { label: 'Undo', run: () => store.togglePin(item) }
    if (result === 'pinned') inbox.notify('Pinned to the bucket.', 'success', undo)
    else inbox.notify('Removed from the bucket.', 'info', undo)
    return result
  }
}
