import process from 'node:process'

import * as Sentry from '@sentry/node'

// Same Sentry project as the SPA (public DSN, see src/main.js); override with
// SENTRY_DSN. Reporting is active on Vercel or when a DSN is set explicitly —
// local dev and tests stay silent.
const DSN =
  process.env.SENTRY_DSN ||
  'https://e5f70dd45644023807e0b6d18cb6896a@o4510748410576896.ingest.de.sentry.io/4511682260566096'

let initialized = false

function enabled() {
  return Boolean(process.env.VERCEL || process.env.SENTRY_DSN)
}

// Reports an API error to Sentry and flushes (serverless instances can be
// suspended right after the response, so an unflushed event is a lost event).
// Never throws — telemetry must not break the API path.
export async function captureApiError(err, context = {}) {
  if (!enabled()) return
  try {
    if (!initialized) {
      Sentry.init({ dsn: DSN, tracesSampleRate: 0 })
      initialized = true
    }
    Sentry.captureException(err, { extra: context })
    await Sentry.flush(2000)
  } catch (sentryErr) {
    console.error('sentry capture failed:', sentryErr?.message)
  }
}
