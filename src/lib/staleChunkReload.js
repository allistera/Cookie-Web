// Recovers from "Failed to fetch dynamically imported module" after a deploy.
//
// Every view and several drawers are lazy chunks with content-hashed names.
// A tab opened before a deploy still runs the old entry bundle, whose chunk
// URLs no longer exist on Vercel once the new deployment is live; the SPA
// rewrite answers those URLs with index.html, so the first route the tab has
// not visited yet fails to import. Vite raises `vite:preloadError` for this
// case; index.html is served with max-age=0, so one reload picks up the
// current bundle. A short cooldown in sessionStorage stops a reload loop if
// the chunk is missing for some other reason.

export const RELOAD_KEY = 'cookie-chunk-reload'
const RELOAD_COOLDOWN_MS = 30_000

function readLastReload(storage) {
  try {
    return Number(storage.getItem(RELOAD_KEY)) || 0
  } catch {
    return 0
  }
}

function writeLastReload(storage, now) {
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
} = {}) {
  if (!target?.addEventListener) return () => {}

  const onPreloadError = (event) => {
    const now = Date.now()
    if (now - readLastReload(storage) < RELOAD_COOLDOWN_MS) return
    writeLastReload(storage, now)
    event.preventDefault()
    reload()
  }

  target.addEventListener('vite:preloadError', onPreloadError)
  return () => target.removeEventListener('vite:preloadError', onPreloadError)
}
