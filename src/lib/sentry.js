import { scheduleIdleTask } from './scheduleIdleTask'

// Load monitoring separately so it does not consume the inbox entry budget,
// and only once the browser is idle (or two seconds have passed), so the SDK
// download does not compete with the first view and its requests.
// A missing DSN, development, and E2E runs never load or initialize the SDK.
//
// Until the SDK is ready nothing of its own is listening, so Vue errors,
// uncaught errors and unhandled rejections are kept here (the first 20) and
// handed over once it starts. The page-load span still begins at the time
// origin and Web Vitals are read from buffered entries; requests made before
// the SDK starts get no http.client span, and a replay begins when it starts.
export function initSentry(
  app,
  loadSdk = () => import('./sentryClient'),
  schedule = scheduleIdleTask,
) {
  if (
    !import.meta.env.PROD ||
    import.meta.env.VITE_E2E === 'true' ||
    !import.meta.env.VITE_SENTRY_DSN
  )
    return Promise.resolve()

  const previousHandler = app.config.errorHandler
  const pending = []
  const keep = (error) => {
    if (error != null && pending.length < 20) pending.push(error)
  }
  app.config.errorHandler = (error, instance, info) => {
    keep(error)
    if (previousHandler) previousHandler.call(app, error, instance, info)
    else console.error('Application error.')
  }
  const onError = (event) => keep(event.error)
  const onRejection = (event) => keep(event.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return new Promise((resolve) => {
    schedule(async () => {
      try {
        const { start } = await loadSdk()
        app.config.errorHandler = previousHandler
        const captureException = start(app)
        for (const error of pending) captureException(error)
      } catch {
        app.config.errorHandler = previousHandler
        console.warn('Sentry unavailable.')
      } finally {
        // The SDK's own global handlers have taken over (or monitoring is off).
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
        pending.length = 0
        resolve()
      }
    })
  })
}
