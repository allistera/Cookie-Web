import { CACHE_STORE, getOfflineDb } from './offlineDb'

const KIND = 'draft-recovery'
const writes = new Set()
const keyFor = (owner, id) => `${owner}:draft-recovery:${id}`

export function newRecoveryId() {
  return crypto.randomUUID()
}

export async function loadDraftRecoveries(owner) {
  return (await getOfflineDb().getAll(CACHE_STORE))
    .filter((entry) => entry.kind === KIND && entry.owner === owner)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function writeDraftRecovery(record, isCurrent = () => true) {
  const plain = JSON.parse(JSON.stringify({ ...record, kind: KIND }))
  const write = getOfflineDb().mutate(CACHE_STORE, keyFor(record.owner, record.id), (current) => {
    if (!isCurrent() || (current?.revision ?? 0) > record.revision) return undefined
    return plain
  })
  writes.add(write)
  return write.finally(() => writes.delete(write))
}

export function removeDraftRecovery(owner, id, revision) {
  return getOfflineDb().mutate(CACHE_STORE, keyFor(owner, id), (current) => {
    if (!current || (revision !== undefined && current.revision !== revision)) return undefined
    return null
  })
}

export async function drainDraftRecoveryWrites() {
  await Promise.allSettled(writes)
}
