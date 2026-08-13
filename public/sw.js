const SHELL_CACHE = 'cookie-shell-v1'
const MAIL_CACHE = 'cookie-recent-mail-v1'
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
  if (url.origin !== self.location.origin) return

  if (url.pathname === '/api/messages' && url.searchParams.has('id')) {
    event.respondWith(recentMailResponse(event))
    return
  }

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
  const cached = await cache.match(cacheKey)
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (response.ok) {
        await cache.delete(cacheKey)
        await cache.put(cacheKey, response.clone())
        await trimCache(cache, MAX_MAIL_ENTRIES)
      }
      return response
    })

  if (cached) {
    event.waitUntil(refresh.catch(() => undefined))
    return cached
  }

  return refresh
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
  return new Request(`${url.origin}/__cookie_mail_cache__/${scope}/${messageId}`)
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
