import { CACHE_STORE, getOfflineDb } from './offlineDb'

// The last good server response for each list a store shows, so a request
// that fails at the network layer can fall back to what the person last saw
// instead of an empty view. Entries are keyed by the signed-in account's
// Auth0 subject, so a different account on the same browser never reads
// another's mail; logout clears the lot (clearOfflineData).
let owner = null

export function setOfflineOwner(sub) {
  owner = sub ? String(sub) : null
}

export function offlineOwner() {
  return owner ?? 'local'
}

function cacheKey(name) {
  return `${offlineOwner()}:${name}`
}

// Resolves { value, savedAt } or null when nothing is cached (or storage is
// unavailable).
export async function readOfflineCache(name) {
  const entry = await getOfflineDb().get(CACHE_STORE, cacheKey(name))
  return entry?.value === undefined ? null : entry
}

// Values are round-tripped through JSON: the stores hand over the server's
// own response objects, but anything reactive or carrying functions would
// fail IndexedDB's structured clone, and a cache write must never fail a
// load that has already succeeded.
export async function writeOfflineCache(name, value) {
  try {
    const plain = JSON.parse(JSON.stringify(value))
    await getOfflineDb().put(CACHE_STORE, { value: plain, savedAt: Date.now() }, cacheKey(name))
  } catch (error) {
    console.error('Failed to cache for offline use:', error)
  }
}

export function removeOfflineCache(name) {
  return getOfflineDb().delete(CACHE_STORE, cacheKey(name))
}

// Caches `value` under `name` and records it in the `indexName` list, which
// keeps at most `max` names: the oldest beyond that are deleted. Used for
// per-item caches (opened documents) that would otherwise grow without bound.
export async function writeRecentOfflineCache(indexName, name, value, max) {
  await writeOfflineCache(name, value)
  const recent = ((await readOfflineCache(indexName))?.value ?? []).filter((item) => item !== name)
  recent.push(name)
  const evicted = recent.splice(0, Math.max(0, recent.length - max))
  await Promise.all(evicted.map((item) => removeOfflineCache(item)))
  await writeOfflineCache(indexName, recent)
}

export async function clearOfflineData() {
  try {
    await getOfflineDb().clearAll()
  } catch (error) {
    console.error('Failed to clear offline data:', error)
  }
}
