import { toRaw } from 'vue'

import { isNetworkError } from './connectivity'
import { readOfflineCache, writeOfflineCache } from './offlineCache'
import { enqueueOutbox } from './outbox'
// One queue per store/session. Failed payloads remain owned by this queue until
// acknowledged or explicitly saved as a copy; navigation cannot discard them.
// A save the tasks Worker cannot be reached for moves to the persistent
// outbox instead (saveState 'offline'): it survives a reload and goes out on
// reconnect through the store's replayDocumentPatch.
const DOCUMENT_PATCH = 'document-patch'
const queues = new WeakMap()
const CONTENT_FIELDS = ['title', 'blocks', 'tags', 'emoji']
function queueFor(store) {
  store = toRaw(store)
  if (!queues.has(store)) {
    queues.set(store, { pending: new Map(), timer: null, inFlight: null, deleted: new Set() })
  }
  return queues.get(store)
}

export function scheduleContentSave(id, patch) {
  const queue = queueFor(this)
  const content = Object.fromEntries(
    CONTENT_FIELDS.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]),
  )
  queue.pending.set(id, { ...queue.pending.get(id), ...content })
  const row = this.documents.find((doc) => doc.id === id)
  const previous = row && { ...row }
  if (row) {
    if (content.title !== undefined) row.title = content.title
    if (content.tags !== undefined) row.tags = content.tags
    if (content.emoji !== undefined) row.emoji = content.emoji
  }
  if (row) this.syncDocumentPages(row, previous)
  if (this.openDoc?.id === id) Object.assign(this.openDoc, content)
  this.saveState = 'saving'
  clearTimeout(queue.timer)
  queue.timer = setTimeout(() => this.flushPendingSave(), 800)
}

export async function flushPendingSave() {
  const queue = queueFor(this)
  clearTimeout(queue.timer)
  if (queue.inFlight) return queue.inFlight
  const operation = (async () => {
    let queuedOffline = false
    while (queue.pending.size) {
      const [id, content] = queue.pending.entries().next().value
      queue.pending.delete(id)
      const row = this.documents.find((doc) => doc.id === id)
      const updatedAt =
        this.openDoc?.id === id ? this.openDoc.updated_at || row?.updated_at : row?.updated_at
      try {
        const body = { id, ...content }
        if (updatedAt) body.updatedAt = updatedAt
        const { document } = await this.request('PATCH', { body })
        const update = { ...document }
        const newer = queue.pending.get(id)
        for (const key of CONTENT_FIELDS) if (newer?.[key] !== undefined) delete update[key]
        if (row) {
          const previous = { ...row }
          Object.assign(row, update)
          this.syncDocumentPages(row, previous)
        }
        if (this.openDoc?.id === id) Object.assign(this.openDoc, update)
        this.saveConflict = false
      } catch (error) {
        // A PATCH that was in flight when its document was deleted: the edit
        // has nowhere to go, and re-queuing it would fail every later flush.
        if (queue.deleted.has(id)) continue
        if (isNetworkError(error) && (await queueOfflineSave(id, content, updatedAt))) {
          queuedOffline = true
          continue
        }
        // Refused by the server, or offline with a queue that cannot be
        // written: the edit stays here, with Retry save and Save a copy.
        queue.pending.set(id, { ...content, ...queue.pending.get(id) })
        this.saveState = 'error'
        this.saveConflict = error?.status === 409
        return false
      }
    }
    this.saveState = queuedOffline ? 'offline' : 'saved'
    return true
  })()
  queue.inFlight = operation
  try {
    return await operation
  } finally {
    if (queue.inFlight === operation) queue.inFlight = null
  }
}

// Removes a document's queued-but-unsent content (a draft acknowledged via
// saveConflictAsCopy, or an edit dropped because its row is being deleted).
// Returns what was dropped — null when nothing was pending — so a caller can
// hand the edit back to the queue if the delete that prompted this fails.
export function discardPendingSave(id) {
  const queue = queueFor(this)
  const content = queue.pending.get(id) ?? null
  queue.pending.delete(id)
  return content
}

// Hands content taken by discardPendingSave back to the queue (the delete
// that dropped it failed). Anything edited since stays on top of it.
export function restorePendingSave(id, content) {
  if (!content) return
  const queue = queueFor(this)
  queue.pending.set(id, { ...content, ...queue.pending.get(id) })
  this.saveState = 'saving'
  clearTimeout(queue.timer)
  queue.timer = setTimeout(() => this.flushPendingSave(), 800)
}

// A deleted document: drop its queued edit, and any PATCH already in flight
// for it that fails is dropped too rather than re-queued.
export function forgetDeletedDocument(id) {
  const queue = queueFor(this)
  queue.deleted.add(id)
  queue.pending.delete(id)
}

// Hands an edit to the outbox and lays it over the document's offline copy,
// so reopening the document offline shows the edit rather than the version
// last fetched. Resolves false when the outbox could not keep the edit.
async function queueOfflineSave(id, content, updatedAt) {
  const payload = { id, ...content }
  if (updatedAt) payload.updatedAt = updatedAt
  try {
    await enqueueOutbox({ kind: DOCUMENT_PATCH, key: id, payload })
  } catch (error) {
    console.error('Failed to queue the document edit for later:', error)
    return false
  }
  const cached = await readOfflineCache(`document:${id}`)
  if (cached) await writeOfflineCache(`document:${id}`, { ...cached.value, ...content })
  return true
}
