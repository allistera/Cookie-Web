import {
  metrics,
  init,
  captureException,
  browserTracingIntegration,
  browserProfilingIntegration,
  replayIntegration,
} from '@sentry/vue'
import { connectMetrics } from './sentryMetrics'
import { createSentryOptions } from './sentryPrivacy'

export function start(
  app,
  sdk = {
    init,
    captureException,
    browserTracingIntegration,
    browserProfilingIntegration,
    replayIntegration,
    metrics,
  },
) {
  sdk.init(createSentryOptions(app, import.meta.env.VITE_SENTRY_DSN, sdk))
  if (sdk.metrics) connectMetrics(sdk.metrics)
  return sdk.captureException
}
