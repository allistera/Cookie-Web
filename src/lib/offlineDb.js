// Promise wrapper over the one IndexedDB database the offline features
// share: a `cache` store of the last server responses the stores hydrate
// from when a request fails at the network layer (offlineCache.js), and an
// `outbox` store of changes made while offline, replayed in order once the
// app is back (outbox.js). Every operation resolves null instead of
// throwing when IndexedDB is missing, blocked (private browsing in some
// browsers) or refuses a transaction, so a store can never be broken by its
// own offline cache.
const DB_NAME = 'cookie-offline'
const DB_VERSION = 1
export const CACHE_STORE = 'cache'
export const OUTBOX_STORE = 'outbox'

export function createOfflineDb({ indexedDB = globalThis.indexedDB ?? null, name = DB_NAME } = {}) {
  let opening = null

  function open() {
    if (!indexedDB) return Promise.resolve(null)
    opening ??= new Promise((resolve) => {
      let request
      try {
        request = indexedDB.open(name, DB_VERSION)
      } catch (error) {
        console.error('Offline storage is unavailable:', error)
        resolve(null)
        return
      }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE)
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.createObjectStore(OUTBOX_STORE, { keyPath: 'seq', autoIncrement: true })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        // Another tab upgrading (or deleting) the database: let go of this
        // connection so it can, and reopen on the next operation.
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      request.onerror = () => {
        console.error('Offline storage failed to open:', request.error)
        resolve(null)
      }
      request.onblocked = () => resolve(null)
    })
    return opening
  }

  async function run(storeName, mode, operate) {
    const db = await open()
    if (!db) return null
    return new Promise((resolve) => {
      let transaction
      try {
        transaction = db.transaction(storeName, mode)
      } catch (error) {
        console.error('Offline storage transaction failed:', error)
        resolve(null)
        return
      }
      let result = null
      const request = operate(transaction.objectStore(storeName))
      request.onsuccess = () => {
        result = request.result ?? null
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => {
        console.error('Offline storage write failed:', transaction.error)
        resolve(null)
      }
      transaction.onabort = () => resolve(null)
    })
  }

  const clear = (storeName) => run(storeName, 'readwrite', (store) => store.clear())

  // Applies a synchronous read/modify/write to all records in one transaction.
  // Used by batch outbox writes so either every row is queued or none is.
  async function updateAll(storeName, update) {
    const db = await open()
    if (!db) return null
    return new Promise((resolve) => {
      let transaction
      try {
        transaction = db.transaction(storeName, 'readwrite')
      } catch (error) {
        console.error('Offline storage transaction failed:', error)
        resolve(null)
        return
      }
      const store = transaction.objectStore(storeName)
      const request = store.getAll()
      request.onsuccess = () => {
        try {
          for (const value of update(request.result)) store.put(value)
        } catch (error) {
          console.error('Offline storage write failed:', error)
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => {
        console.error('Offline storage write failed:', transaction.error)
        resolve(null)
      }
      transaction.onabort = () => resolve(null)
    })
  }

  // A read/modify/write in one transaction. Returning undefined keeps the
  // current value; null deletes it. Used when an acknowledgement must not
  // remove a newer local edit that arrived while its request was in flight.
  async function mutate(storeName, key, update) {
    const db = await open()
    if (!db) return null
    return new Promise((resolve) => {
      let transaction
      try {
        transaction = db.transaction(storeName, 'readwrite')
      } catch {
        resolve(null)
        return
      }
      const store = transaction.objectStore(storeName)
      const request = store.get(key)
      let changed = false
      request.onsuccess = () => {
        try {
          const next = update(request.result)
          if (next === undefined) return
          if (next === null) store.delete(key)
          else if (store.keyPath) store.put(next)
          else store.put(next, key)
          changed = true
        } catch {
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(changed)
      transaction.onerror = () => resolve(null)
      transaction.onabort = () => resolve(null)
    })
  }

  return {
    get: (storeName, key) => run(storeName, 'readonly', (store) => store.get(key)),
    getAll: async (storeName) =>
      (await run(storeName, 'readonly', (store) => store.getAll())) ?? [],
    // Returns the stored key (the generated one for the outbox).
    put: (storeName, value, key) =>
      run(storeName, 'readwrite', (store) =>
        key === undefined ? store.put(value) : store.put(value, key),
      ),
    updateAll,
    mutate,
    delete: (storeName, key) => run(storeName, 'readwrite', (store) => store.delete(key)),
    clear,
    clearAll: () => Promise.all([clear(CACHE_STORE), clear(OUTBOX_STORE)]),
  }
}

let instance = null

export function getOfflineDb() {
  instance ??= createOfflineDb()
  return instance
}

// Tests hand in a database over fake-indexeddb here rather than mocking the
// module; null restores the lazily created default.
export function setOfflineDb(db) {
  instance = db
}
