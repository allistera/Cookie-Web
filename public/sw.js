const SHELL_CACHE = 'cookie-shell-v1'
const MAIL_CACHE = 'cookie-recent-mail-v3'
// Vite development serves a large module graph one file at a time; production
// bundles need only a small bounded cache across deployments.
const MAX_SHELL_ENTRIES = self.location.hostname === 'localhost' ? 500 : 60
const MAX_MAIL_ENTRIES = 20
const SHELL_URLS = [
  '/',
  '/site.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
]
const STATIC_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style'])

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.allSettled(
        SHELL_URLS.map(async (url) => {
          const response = await fetch(url, { cache: 'reload' })
          if (response.ok) await cache.put(url, response)
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const currentCaches = new Set([SHELL_CACHE, MAIL_CACHE])
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('cookie-') && !currentCaches.has(cacheName))
          .map((cacheName) => caches.delete(cacheName)),
      )
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
    event.respondWith(shellNavigationResponse(request))
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

async function shellNavigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
      await trimCache(cache, MAX_SHELL_ENTRIES)
    }
    return response
  } catch {
    return (await cache.match(request)) ?? (await cache.match('/'))
  }
}

async function staticAssetResponse(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    await trimCache(cache, MAX_SHELL_ENTRIES)
  }
  return response
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
