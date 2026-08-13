import process from 'node:process'

// Same Sentry project as the SPA (public DSN, see src/main.js); override with
// SENTRY_DSN. Reporting is active on Vercel or when a DSN is set explicitly —
// local dev and tests stay silent.
const DSN =
  process.env.SENTRY_DSN ||
  'https://e5f70dd45644023807e0b6d18cb6896a@o4510748410576896.ingest.de.sentry.io/4511682260566096'

function enabled() {
  return Boolean(process.env.VERCEL || process.env.SENTRY_DSN)
}

// Builds the capture function around a Sentry loader; tests pass a fake
// loader and get an isolated init/flush lifecycle instead of mocking the
// @sentry/node module.
export function createErrorCapture(loadSentry = () => import('@sentry/node')) {
  let initialized = false
  let sentryPromise

  // Reports an API error to Sentry and flushes (serverless instances can be
  // suspended right after the response, so an unflushed event is a lost
  // event). Never throws — telemetry must not break the API path.
  return async function captureApiError(err, context = {}) {
    if (!enabled()) return
    try {
      sentryPromise ||= loadSentry()
      const Sentry = await sentryPromise
      if (!initialized) {
        Sentry.init({ dsn: DSN })
        initialized = true
      }
      Sentry.captureException(err, { extra: context })
      await Sentry.flush(2000)
    } catch (sentryErr) {
      console.error('sentry capture failed:', sentryErr?.message)
    }
  }
}

export const captureApiError = createErrorCapture()
