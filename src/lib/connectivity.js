import { readonly, ref } from 'vue'

// One view of "can the app reach its Workers right now". The browser's own
// online/offline events are the first signal, but navigator.onLine is true
// behind a captive portal or when a single Worker is unreachable, so a
// request that fails at the network layer also marks the app offline until
// the next request that lands.
const online = ref(globalThis.navigator?.onLine ?? true)
const reconnectListeners = new Set()

export const isOnline = readonly(online)

// fetch rejects with a TypeError when the network layer fails ("Failed to
// fetch", "NetworkError when attempting to fetch resource.", "Load failed");
// an HTTP failure comes back as a response, or as the stores' own Error
// carrying a status. The Auth0 SDK surfaces a stalled token request as a
// GenericError whose code is 'timeout'.
export function isNetworkError(error) {
  if (error instanceof TypeError && error.status === undefined) return true
  return String(error?.error ?? '') === 'timeout'
}

function becomeOnline() {
  if (online.value) return
  online.value = true
  for (const listener of reconnectListeners) {
    try {
      listener()
    } catch (error) {
      console.error('Reconnect listener failed:', error)
    }
  }
}

export function noteNetworkFailure() {
  online.value = false
}

export function noteNetworkSuccess() {
  becomeOnline()
}

// Runs when the app goes from offline back to online, whichever signal says
// so. Returns the unsubscribe.
export function onReconnect(listener) {
  reconnectListeners.add(listener)
  return () => reconnectListeners.delete(listener)
}

export function installConnectivityListeners(target = globalThis.window) {
  if (!target?.addEventListener) return () => {}
  const goOnline = () => becomeOnline()
  const goOffline = () => noteNetworkFailure()
  target.addEventListener('online', goOnline)
  target.addEventListener('offline', goOffline)
  return () => {
    target.removeEventListener('online', goOnline)
    target.removeEventListener('offline', goOffline)
  }
}

export function resetConnectivityForTests() {
  online.value = globalThis.navigator?.onLine ?? true
  reconnectListeners.clear()
}
