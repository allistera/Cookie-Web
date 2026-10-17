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
// request's own fields. Each merge bumps the entry's revision, which is how
// replay tells that an entry changed while its request was in flight.
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

// Rejects when the change could not be stored (IndexedDB missing, blocked
// or out of space): the caller must then treat the change as failed rather
// than as saved on this device, since nothing would ever send it.
export async function enqueueOutbox({ kind, key, payload }) {
  const db = getOfflineDb()
  const existing = (await ownEntries()).find((entry) => entry.kind === kind && entry.key === key)
  const stored = existing
    ? await db.put(OUTBOX_STORE, {
        ...existing,
        payload: { ...existing.payload, ...payload },
        revision: (existing.revision ?? 1) + 1,
        updatedAt: Date.now(),
      })
    : await db.put(OUTBOX_STORE, {
        kind,
        key,
        owner: offlineOwner(),
        payload,
        revision: 1,
        createdAt: Date.now(),
      })
  await refreshOutboxPending()
  if (stored === null) throw new Error('Offline storage is unavailable; the change was not kept')
}

// Stores a batch in one readwrite transaction. This prevents a partial offline
// batch from being replayed after the caller has rolled back its optimistic UI.
export async function enqueueOutboxBatch(entries) {
  if (!entries.length) return
  const db = getOfflineDb()
  const owner = offlineOwner()
  const stored = await db.updateAll(OUTBOX_STORE, (current) => {
    const byKey = new Map(
      current
        .filter((entry) => entry.owner === owner)
        .map((entry) => [`${entry.kind}\0${entry.key}`, entry]),
    )
    const writes = new Map()
    for (const { kind, key, payload } of entries) {
      const compoundKey = `${kind}\0${key}`
      const existing = writes.get(compoundKey) ?? byKey.get(compoundKey)
      writes.set(
        compoundKey,
        existing
          ? {
              ...existing,
              payload: { ...existing.payload, ...payload },
              revision: (existing.revision ?? 1) + 1,
              updatedAt: Date.now(),
            }
          : {
              kind,
              key,
              owner,
              payload,
              revision: 1,
              createdAt: Date.now(),
            },
      )
    }
    return [...writes.values()]
  })
  await refreshOutboxPending()
  if (stored === null) throw new Error('Offline storage is unavailable; the changes were not kept')
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
// and skipped; see syncOutbox. An entry edited while its request was in
// flight (its revision moved on) is kept too, and sent in a further pass.
export function flushOutbox() {
  flushing ??= replay().finally(() => {
    flushing = null
  })
  return flushing
}

// Bounds the passes a stream of edits during replay can cause; whatever is
// still queued after that goes out on the next sync.
const MAX_REPLAY_PASSES = 5

async function replay() {
  const result = { replayed: 0, dropped: 0, remaining: 0 }
  for (let pass = 0; pass < MAX_REPLAY_PASSES; pass++) {
    const { stopped, revised } = await replayPass(result)
    if (stopped || !revised) break
  }
  await refreshOutboxPending()
  return result
}

async function replayPass(result) {
  const db = getOfflineDb()
  const entries = await ownEntries()
  result.remaining = 0
  let revised = 0
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
        return { stopped: true, revised }
      }
      console.error('Dropped an offline change the server refused:', error)
      result.dropped++
    }
    // Only the revision that was sent is settled: a change merged in while
    // the request ran stays queued and goes in the next pass.
    const current = await db.get(OUTBOX_STORE, entry.seq)
    if (current && (current.revision ?? 1) !== (entry.revision ?? 1)) {
      revised++
      continue
    }
    await db.delete(OUTBOX_STORE, entry.seq)
  }
  result.remaining += revised
  return { stopped: false, revised }
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
