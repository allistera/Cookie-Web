import { toRaw } from 'vue'
// One queue per store/session. Failed payloads remain owned by this queue until
// acknowledged or explicitly saved as a copy; navigation cannot discard them.
const queues = new WeakMap()
const CONTENT_FIELDS = ['title', 'blocks', 'tags']
function queueFor(store) {
  store = toRaw(store)
  if (!queues.has(store)) queues.set(store, { pending: new Map(), timer: null, inFlight: null })
  return queues.get(store)
}

export function scheduleContentSave(id, patch) {
  const queue = queueFor(this)
  const content = Object.fromEntries(
    CONTENT_FIELDS.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]),
  )
  queue.pending.set(id, { ...queue.pending.get(id), ...content })
  const row = this.documents.find((doc) => doc.id === id)
  if (row) {
    if (content.title !== undefined) row.title = content.title
    if (content.tags !== undefined) row.tags = content.tags
  }
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
        if (row) Object.assign(row, update)
        if (this.openDoc?.id === id) Object.assign(this.openDoc, update)
        this.saveConflict = false
      } catch (error) {
        queue.pending.set(id, { ...content, ...queue.pending.get(id) })
        this.saveState = 'error'
        this.saveConflict = error?.status === 409
        return false
      }
    }
    this.saveState = 'saved'
    return true
  })()
  queue.inFlight = operation
  try {
    return await operation
  } finally {
    if (queue.inFlight === operation) queue.inFlight = null
  }
}

export function discardPendingSave(id) {
  queueFor(this).pending.delete(id)
}
