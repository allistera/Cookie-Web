import { readonly, ref } from 'vue'

import { isNetworkError, noteNetworkFailure, noteNetworkSuccess, onReconnect } from './connectivity'
import { offlineOwner } from './offlineCache'
import { OUTBOX_STORE, getOfflineDb } from './offlineDb'

// Changes made while a Worker was unreachable, kept in IndexedDB until they
// have been sent. A store enqueues when its request fails at the network
// layer (the optimistic change stays on screen), and registers a handler per
// `kind` that performs the request again on replay. Replay runs in the order
// the changes were made, on reconnect, when the tab becomes visible, and
// once at boot.
//
// Entries for the same kind and key (one message, one task, one document)
// coalesce: the later payload is merged over the earlier one, so two star
// toggles become one request and a title edit and a body edit of the same
// document travel together. Payloads are therefore flat objects of the
// request's own fields.
const handlers = new Map()
const pending = ref(0)
let flushing = null

export const outboxPending = readonly(pending)

export function registerOutboxHandler(kind, handler) {
  handlers.set(kind, handler)
}

async function ownEntries() {
  const owner = offlineOwner()
  return (await getOfflineDb().getAll(OUTBOX_STORE)).filter((entry) => entry.owner === owner)
}

export async function refreshOutboxPending() {
  pending.value = (await ownEntries()).length
  return pending.value
}

export async function enqueueOutbox({ kind, key, payload }) {
  const db = getOfflineDb()
  const existing = (await ownEntries()).find((entry) => entry.kind === kind && entry.key === key)
  if (existing) {
    await db.put(OUTBOX_STORE, {
      ...existing,
      payload: { ...existing.payload, ...payload },
      updatedAt: Date.now(),
    })
  } else {
    await db.put(OUTBOX_STORE, { kind, key, owner: offlineOwner(), payload, createdAt: Date.now() })
  }
  await refreshOutboxPending()
}

// Queued changes of one kind, oldest first, so a store hydrating from its
// offline cache can lay them over the cached rows.
export async function pendingOutboxEntries(kind) {
  return (await ownEntries()).filter((entry) => entry.kind === kind)
}

// Resolves { replayed, dropped, remaining }. A network failure stops the
// replay and keeps the rest for next time; a change the server refuses
// (gone, conflicting, invalid) is dropped, since sending it again would
// fail the same way and block everything behind it. Handlers tell the
// person about such a drop themselves where it matters. An entry whose
// handler is not registered yet (its store module has not loaded) is kept
// and skipped; see syncOutbox.
export function flushOutbox() {
  flushing ??= replay().finally(() => {
    flushing = null
  })
  return flushing
}

async function replay() {
  const db = getOfflineDb()
  const result = { replayed: 0, dropped: 0, remaining: 0 }
  const entries = await ownEntries()
  for (const [index, entry] of entries.entries()) {
    const handler = handlers.get(entry.kind)
    if (!handler) {
      result.remaining++
      continue
    }
    try {
      await handler(entry.payload)
      noteNetworkSuccess()
      result.replayed++
    } catch (error) {
      if (isNetworkError(error)) {
        noteNetworkFailure()
        result.remaining += entries.length - index
        break
      }
      console.error('Dropped an offline change the server refused:', error)
      result.dropped++
    }
    await db.delete(OUTBOX_STORE, entry.seq)
  }
  await refreshOutboxPending()
  return result
}

// Replays whatever is queued, after `prepare` has had the chance to load
// the store modules that register the handlers. The stores live in lazy
// view chunks, so a session that has not opened Tasks or Documents has not
// registered theirs; loading them only when something is queued keeps the
// entry bundle small.
export async function syncOutbox({ prepare = async () => {} } = {}) {
  if (!(await refreshOutboxPending())) return { replayed: 0, dropped: 0, remaining: 0 }
  await prepare()
  return flushOutbox()
}

// Wires replay to the signals that mean the Workers may be reachable again.
// `onSynced` runs after every reconnect (lists hydrated from the offline
// cache are stale whether or not anything was queued) and after a visible
// tab's replay that sent or dropped something, so the caller can refetch.
export function installOutboxSync({
  target = globalThis.document,
  prepare,
  onSynced = async () => {},
} = {}) {
  const sync = async (always) => {
    const result = await syncOutbox({ prepare })
    if (always || result.replayed || result.dropped) await onSynced(result)
  }
  const stopReconnect = onReconnect(() => sync(true))
  const onVisible = () => {
    if (target.visibilityState === 'visible') sync(false)
  }
  target?.addEventListener?.('visibilitychange', onVisible)
  return () => {
    stopReconnect()
    target?.removeEventListener?.('visibilitychange', onVisible)
  }
}

export function resetOutboxForTests() {
  handlers.clear()
  pending.value = 0
  flushing = null
}
