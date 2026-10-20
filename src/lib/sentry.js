// Load monitoring separately so it does not consume the inbox entry budget.
// A missing DSN, development, and E2E runs never load or initialize the SDK.
export async function initSentry(app, loadSdk = () => import('@sentry/vue')) {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!import.meta.env.PROD || import.meta.env.VITE_E2E === 'true' || !dsn) return

  const previousHandler = app.config.errorHandler
  const pending = []
  app.config.errorHandler = (error, instance, info) => {
    if (pending.length < 20) pending.push(error)
    if (previousHandler) previousHandler.call(app, error, instance, info)
    else console.error('An application error occurred before monitoring was ready.')
  }

  try {
    const [{ init, captureException }, { sanitizeEvent }] = await Promise.all([
      loadSdk(),
      import('./sentryPrivacy'),
    ])
    app.config.errorHandler = previousHandler
    init({
      app,
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      attachProps: false,
      tracesSampleRate: 0,
      // Sentry 11 collects these categories by default. Mailbox content and
      // authentication data must not become diagnostic context.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
      },
      beforeSend: sanitizeEvent,
    })
    for (const error of pending) captureException(error)
  } catch {
    app.config.errorHandler = previousHandler
    console.warn('Error monitoring could not be initialized.')
  } finally {
    pending.length = 0
  }
}
