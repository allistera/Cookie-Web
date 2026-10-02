// Recovers lazy routes and lazy components from stale chunks after a deploy.
//
// lib/staleChunkReload covers `vite:preloadError`; a failed import that never
// reaches Vite's preload helper surfaces instead as a router navigation error
// or a defineAsyncComponent load error. Both paths here reload once — to the
// route being opened, not the one being left — and share that module's
// sessionStorage timestamp, so between them a tab reloads at most once per
// cooldown and a chunk missing for another reason cannot loop.

import { defineAsyncComponent } from 'vue'

import { RELOAD_KEY } from '../lib/staleChunkReload'

const RELOAD_COOLDOWN_MS = 30_000

// Chrome, Firefox and Safari word a failed dynamic import differently; Vite's
// CSS preload adds its own.
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function isChunkLoadError(error) {
  return CHUNK_ERROR.test(String(error?.message ?? error ?? ''))
}

// Reloads to `href` unless a stale-chunk reload already happened within the
// cooldown. Returns whether it reloaded.
export function reloadForStaleChunk(
  href,
  {
    storage = globalThis.sessionStorage,
    navigate = (url) => globalThis.location.assign(url),
    now = Date.now(),
  } = {},
) {
  try {
    if (now - (Number(storage.getItem(RELOAD_KEY)) || 0) < RELOAD_COOLDOWN_MS) return false
    storage.setItem(RELOAD_KEY, String(now))
  } catch {
    // Blocked storage: reload anyway; the cooldown is best-effort.
  }
  navigate(href)
  return true
}

export function installRouterChunkReload(router, options) {
  router.onError((error, to) => {
    if (!isChunkLoadError(error)) return
    const href = to?.fullPath ? router.resolve(to.fullPath).href : globalThis.location.href
    reloadForStaleChunk(href, options)
  })
}

// defineAsyncComponent with one retry, then the stale-chunk reload; if that is
// on cooldown (or the error is not a chunk failure) the component fails and
// renders nothing rather than retrying forever.
export function lazyComponent(loader, options) {
  return defineAsyncComponent({
    loader,
    onError(error, retry, fail, attempts) {
      if (!isChunkLoadError(error)) return fail()
      if (attempts <= 1) return retry()
      if (!reloadForStaleChunk(globalThis.location.href, options)) fail()
    },
  })
}
