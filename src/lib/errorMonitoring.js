import { init } from '@sentry/vue'

const DSN =
  'https://e5f70dd45644023807e0b6d18cb6896a@o4510748410576896.ingest.de.sentry.io/4511682260566096'

// Error reporting only. Performance tracing, Session Replay, and Sentry Logs
// are intentionally not initialized.
export function initErrorMonitoring(app) {
  init({ app, dsn: DSN })
}
