// Load monitoring separately so it does not consume the inbox entry budget.
// A missing DSN, development, and E2E runs never load or initialize the SDK.
export async function initSentry(app, loadSdk = () => import('@sentry/vue')) {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!import.meta.env.PROD || import.meta.env.VITE_E2E === 'true' || !dsn) return

  try {
    const { init } = await loadSdk()
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
      beforeSend(event) {
        return {
          ...event,
          request: undefined,
          user: undefined,
          breadcrumbs: undefined,
          tags: { ...event.tags, service: 'cookie-web' },
        }
      },
    })
  } catch {
    // Monitoring must not prevent the app from mounting if its chunk fails
    // to load (for example, when blocked by an extension).
    console.warn('Error monitoring could not be initialized.')
  }
}
