const CLEAR_MAIL_CACHE_MESSAGE = 'CLEAR_MAIL_CACHE'

export async function registerServiceWorker({
  isProduction = import.meta.env.PROD,
  serviceWorker = typeof navigator === 'undefined' ? null : navigator.serviceWorker,
} = {}) {
  if (!isProduction || !serviceWorker) return null

  try {
    return await serviceWorker.register('/sw.js')
  } catch (error) {
    console.error('Failed to register service worker:', error)
    return null
  }
}

export function clearCachedMail(
  serviceWorker = typeof navigator === 'undefined' ? null : navigator.serviceWorker,
) {
  serviceWorker?.controller?.postMessage({ type: CLEAR_MAIL_CACHE_MESSAGE })
}
