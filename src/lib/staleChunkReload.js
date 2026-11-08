// Recovers from "Failed to fetch dynamically imported module" after a deploy.
//
// Every view and several drawers are lazy chunks with content-hashed names.
// A tab opened before a deploy still runs the old entry bundle, whose chunk
// URLs no longer exist on Vercel once the new deployment is live; the SPA
// rewrite answers those URLs with index.html, so the first route the tab has
// not visited yet fails to import. Vite raises `vite:preloadError` for this
// case; index.html is served with max-age=0, so one reload picks up the
// current bundle. A short cooldown in sessionStorage stops a reload loop if
// the chunk is missing for some other reason. Offline, the chunk is missing
// because it was never cached, and a reload would only lose the page the
// person is on: the error is left to surface instead.

export const RELOAD_KEY = 'cookie-chunk-reload'
const RELOAD_COOLDOWN_MS = 30_000

// Chrome, Firefox and Safari word a failed dynamic import differently; Vite's
// CSS preload adds its own. When a `vite:preloadError` handler prevents the
// default, Vite's helper resolves the import with nothing instead, and
// vue-router then reports the route's component as unresolved
// (COOKIE-WEB-1K): the same stale chunk, one step later.
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Couldn't resolve component/i

export function isChunkLoadError(error) {
  return CHUNK_ERROR.test(String(error?.message ?? error ?? ''))
}

// Whether a stale-chunk reload was started within the cooldown, here or in
// router/chunkReload. The error that triggered it is already being dealt with.
// Blocked storage reads as "no reload yet".
export function isReloadingForStaleChunk(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    return now - (Number(storage.getItem(RELOAD_KEY)) || 0) < RELOAD_COOLDOWN_MS
  } catch {
    return false
  }
}

export function recordStaleChunkReload(storage, now) {
  try {
    storage.setItem(RELOAD_KEY, String(now))
  } catch {
    // Private mode or blocked storage: reload anyway; the cooldown is best-effort.
  }
}

export function installStaleChunkReload({
  target = globalThis.window,
  storage = globalThis.sessionStorage,
  reload = () => globalThis.location.reload(),
  isOnline = () => globalThis.navigator?.onLine ?? true,
} = {}) {
  if (!target?.addEventListener) return () => {}

  const onPreloadError = (event) => {
    if (!isOnline()) return
    const now = Date.now()
    if (isReloadingForStaleChunk(storage, now)) return
    recordStaleChunkReload(storage, now)
    event.preventDefault()
    reload()
  }

  target.addEventListener('vite:preloadError', onPreloadError)
  return () => target.removeEventListener('vite:preloadError', onPreloadError)
}
