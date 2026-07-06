import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as Sentry from '@sentry/vue'

import App from './App.vue'
import router from './router'
import { getAuth0 } from './auth0-client'

const app = createApp(App)

// E2E mode (vite --mode e2e) runs without Sentry and with stubbed auth so
// Playwright can drive the app deterministically.
const isE2E = import.meta.env.VITE_E2E === 'true'

if (!isE2E) {
  Sentry.init({
    app,
    dsn: 'https://e5f70dd45644023807e0b6d18cb6896a@o4510748410576896.ingest.de.sentry.io/4511682260566096',
    integrations: [
      Sentry.browserTracingIntegration({ router }),
      Sentry.replayIntegration(),
      Sentry.consoleLoggingIntegration(),
    ],
    // Performance Monitoring / Tracing
    tracesSampleRate: 1.0,
    // Session Replay
    replaysSessionSampleRate: 1.0,
    replaysOnErrorSampleRate: 1.0,
    // Structured Logging
    enableLogs: true,
  })
}

app.use(createPinia())
app.use(router)
if (!isE2E) {
  app.use(getAuth0())
}

app.mount('#app')
