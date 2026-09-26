// The shell cache holds only SHELL_URLS plus the entry assets index.html
// references, and is never trimmed: an offline start needs all of it. Lazily
// loaded chunks go to the bounded runtime cache instead, so they can never
// evict the shell.
const SHELL_CACHE = 'cookie-shell-v1'
const RUNTIME_CACHE = 'cookie-runtime-v1'
const MAIL_CACHE = 'cookie-recent-mail-v3'
// Vite development serves a large module graph one file at a time; production
// bundles need only a small bounded cache across deployments.
const MAX_RUNTIME_ENTRIES = self.location.hostname === 'localhost' ? 500 : 60
const MAX_MAIL_ENTRIES = 20
// Every SW update re-runs install, which re-fetches this whole list, so new
// entries reach existing installs without renaming SHELL_CACHE. The same
// mechanism is how a regenerated icon font reaches installs: the woff2 keeps
// its URL and staticAssetResponse is cache-first, so bump the revision below
// whenever `npm run fetch:icon-font` changes public/fonts/, or existing
// installs render new glyphs as their ligature text.
// Icon subset revision: 2026-09-26 (document icon set)
const SHELL_URLS = [
  '/',
  '/site.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  // Self-hosted Material Symbols subset (src/lib/iconFont.js). Without these
  // an offline start renders every icon hidden by main.css.
  '/fonts/material-symbols-outlined.css',
  '/fonts/material-symbols-outlined.woff2',
]
const STATIC_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style'])

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.allSettled(
        SHELL_URLS.map(async (url) => {
          const response = await fetch(url, { cache: 'reload' })
          if (!response.ok) return
          if (url === '/') await cacheShellDocument(response)
          else await cache.put(url, response)
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const currentCaches = new Set([SHELL_CACHE, RUNTIME_CACHE, MAIL_CACHE])
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('cookie-') && !currentCaches.has(cacheName))
          .map((cacheName) => caches.delete(cacheName)),
      )
      // Earlier workers put every navigation URL (Auth0 ?code=&state=
      // callbacks, search queries) and every lazy chunk into the shell cache.
      await pruneShellCache()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_MAIL_CACHE') {
    event.waitUntil(caches.delete(MAIL_CACHE))
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return

  const url = new URL(request.url)

  // Message bodies are served by the cookie-web-messages Cloudflare Worker
  // (cross-origin). The e2e/dev Vite middleware serves them same-origin at
  // /api/messages. Both paths are mail-cache candidates; sibling resources
  // (?resource=attachment|contacts) are not.
  const isMailCacheRequest =
    url.searchParams.has('id') &&
    !url.searchParams.has('resource') &&
    ((url.origin === self.location.origin && url.pathname === '/api/messages') ||
      (url.origin === 'https://messages-api.infinitywave.online' && url.pathname === '/messages'))
  if (isMailCacheRequest) {
    event.respondWith(recentMailResponse(event))
    return
  }

  // Remaining paths (shell navigation, static assets) are same-origin only.
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(shellNavigationResponse(event))
    return
  }

  if (!url.pathname.startsWith('/api/') && STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(staticAssetResponse(request))
  }
})

async function recentMailResponse(event) {
  const cache = await caches.open(MAIL_CACHE)
  const cacheKey = await privateMailCacheKey(event.request)
  try {
    const response = await fetch(event.request)
    if (response.ok) {
      await cache.delete(cacheKey)
      await cache.put(cacheKey, response.clone())
      await trimCache(cache, MAX_MAIL_ENTRIES)
    }
    return response
  } catch {
    const cached = await cache.match(cacheKey)
    if (cached) return cached
    throw new Error('Failed to fetch mail')
  }
}

// Every SPA route is the same index.html, so it is cached once under "/"
// rather than per URL; per-URL keys would also persist Auth0 callback codes
// and search queries.
async function shellNavigationResponse(event) {
  try {
    const response = await fetch(event.request)
    if (response.ok && isHtml(response)) event.waitUntil(cacheShellDocument(response.clone()))
    return response
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    return cache.match('/')
  }
}

async function staticAssetResponse(request) {
  const cached =
    (await (await caches.open(SHELL_CACHE)).match(request)) ??
    (await (await caches.open(RUNTIME_CACHE)).match(request))
  if (cached) return cached

  const response = await fetch(request)
  // A missing file answered with the SPA's index.html must not be cached
  // cache-first under a script or style URL.
  if (response.ok && !isHtml(response)) {
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.put(request, response.clone())
    await trimCache(cache, MAX_RUNTIME_ENTRIES)
  }
  return response
}

function isHtml(response) {
  return (response.headers.get('Content-Type') ?? '').includes('text/html')
}

// Stores index.html as "/" together with the hashed entry script, styles, and
// modulepreloads it references, so an offline start does not depend on the
// bounded runtime cache.
async function cacheShellDocument(response) {
  const cache = await caches.open(SHELL_CACHE)
  const entryUrls = entryAssetUrls(await response.clone().text())
  const stored = await Promise.all(
    entryUrls.map(async (url) => {
      if (await cache.match(url)) return true
      try {
        const asset = await fetch(url)
        if (!asset.ok || isHtml(asset)) return false
        await cache.put(url, asset)
        return true
      } catch {
        return false
      }
    }),
  )
  // Only swap in the new document once every entry asset it needs is in the
  // untrimmed cache; otherwise keep the previous "/" and its assets so an
  // offline start never depends on the bounded runtime cache.
  if (!stored.every(Boolean)) return
  await cache.put('/', response)
  await pruneShellCache()
}

function entryAssetUrls(html) {
  return [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))]
}

// Keeps the untrimmed shell cache bounded: anything that is neither a
// SHELL_URL nor an entry asset of the cached "/" document (a previous
// deployment's bundle, a navigation cached per URL by an earlier worker)
// is dropped.
async function pruneShellCache() {
  const cache = await caches.open(SHELL_CACHE)
  const shell = await cache.match('/')
  const keep = new Set([...SHELL_URLS, ...(shell ? entryAssetUrls(await shell.text()) : [])])
  const keys = await cache.keys()
  await Promise.all(
    keys
      .filter((key) => {
        const url = new URL(key.url)
        return url.search !== '' || !keep.has(url.pathname)
      })
      .map((key) => cache.delete(key)),
  )
}

async function privateMailCacheKey(request) {
  const url = new URL(request.url)
  const identity = bearerSubject(request.headers.get('Authorization'))
  const scope = await digest(identity)
  const messageId = encodeURIComponent(url.searchParams.get('id'))
  const resource = encodeURIComponent(url.searchParams.get('resource') ?? 'message')
  return new Request(`${url.origin}/__cookie_mail_cache__/${scope}/${resource}/${messageId}`)
}

function bearerSubject(authorization) {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return 'anonymous'

  try {
    const payload = token.split('.')[1]
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
    const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    const sub = String(decoded.sub ?? '')
    return sub || token
  } catch {
    return token
  }
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function trimCache(cache, maximumEntries) {
  const keys = await cache.keys()
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - maximumEntries)).map((key) => cache.delete(key)),
  )
}
