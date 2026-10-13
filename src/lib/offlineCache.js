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

function cacheKey(name, owner) {
  return `${owner}:${name}`
}

// Resolves { value, savedAt } or null when nothing is cached (or storage is
// unavailable).
export async function readOfflineCache(name, owner = offlineOwner()) {
  const entry = await getOfflineDb().get(CACHE_STORE, cacheKey(name, owner))
  return entry?.value === undefined ? null : entry
}

// Values are round-tripped through JSON: the stores hand over the server's
// own response objects, but anything reactive or carrying functions would
// fail IndexedDB's structured clone, and a cache write must never fail a
// load that has already succeeded.
//
// `owner` is the account the response belongs to. Loaders capture it before
// their request goes out (offlineOwner() at that moment), so a response that
// lands after the account changed is still filed under the account that
// asked for it, never under the one now signed in.
export async function writeOfflineCache(name, value, owner = offlineOwner()) {
  try {
    const plain = JSON.parse(JSON.stringify(value))
    await getOfflineDb().put(
      CACHE_STORE,
      { value: plain, savedAt: Date.now() },
      cacheKey(name, owner),
    )
  } catch (error) {
    console.error('Failed to cache for offline use:', error)
  }
}

export function removeOfflineCache(name, owner = offlineOwner()) {
  return getOfflineDb().delete(CACHE_STORE, cacheKey(name, owner))
}

// Caches `value` under `name` and records it in the `indexName` list, which
// keeps at most `max` names: the oldest beyond that are deleted. Used for
// per-item caches (opened documents) that would otherwise grow without bound.
export async function writeRecentOfflineCache(indexName, name, value, max, owner = offlineOwner()) {
  await writeOfflineCache(name, value, owner)
  const recent = ((await readOfflineCache(indexName, owner))?.value ?? []).filter(
    (item) => item !== name,
  )
  recent.push(name)
  const evicted = recent.splice(0, Math.max(0, recent.length - max))
  await Promise.all(evicted.map((item) => removeOfflineCache(item, owner)))
  await writeOfflineCache(indexName, recent, owner)
}

export async function clearOfflineData() {
  try {
    await getOfflineDb().clearAll()
  } catch (error) {
    console.error('Failed to clear offline data:', error)
  }
}
