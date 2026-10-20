import {
  init,
  captureException,
  browserTracingIntegration,
  browserProfilingIntegration,
} from '@sentry/vue'
import { createSentryOptions } from './sentryPrivacy'

export function start(
  app,
  sdk = { init, captureException, browserTracingIntegration, browserProfilingIntegration },
) {
  sdk.init(createSentryOptions(app, import.meta.env.VITE_SENTRY_DSN, sdk))
  return sdk.captureException
}
