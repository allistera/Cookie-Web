// Load monitoring separately so it does not consume the inbox entry budget.
// A missing DSN, development, and E2E runs never load or initialize the SDK.
export async function initSentry(app, loadSdk = () => import('./sentryClient')) {
  if (
    !import.meta.env.PROD ||
    import.meta.env.VITE_E2E === 'true' ||
    !import.meta.env.VITE_SENTRY_DSN
  )
    return

  const previousHandler = app.config.errorHandler
  const pending = []
  app.config.errorHandler = (error, instance, info) => {
    if (pending.length < 20) pending.push(error)
    if (previousHandler) previousHandler.call(app, error, instance, info)
    else console.error('Application error.')
  }

  try {
    const { start } = await loadSdk()
    app.config.errorHandler = previousHandler
    const captureException = start(app)
    for (const error of pending) captureException(error)
  } catch {
    app.config.errorHandler = previousHandler
    console.warn('Sentry unavailable.')
  } finally {
    pending.length = 0
  }
}
