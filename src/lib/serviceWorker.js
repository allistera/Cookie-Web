const CLEAR_MAIL_CACHE_MESSAGE = 'CLEAR_MAIL_CACHE'

export async function registerServiceWorker({
  isProduction = import.meta.env.PROD,
  serviceWorker = globalThis.navigator?.serviceWorker ?? null,
} = {}) {
  if (!isProduction || !serviceWorker) return null

  try {
    return await serviceWorker.register('/sw.js')
  } catch (error) {
    console.error('Failed to register service worker:', error)
    return null
  }
}

export function clearCachedMail(serviceWorker = globalThis.navigator?.serviceWorker ?? null) {
  serviceWorker?.controller?.postMessage({ type: CLEAR_MAIL_CACHE_MESSAGE })
}
