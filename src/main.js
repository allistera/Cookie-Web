import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { getAuth0 } from './auth0-client'
import { initTheme } from './lib/theme'

// Apply the saved theme (and start tracking the OS for 'system') before mount
// so the first paint already carries the right data-theme — no flash.
initTheme()

const app = createApp(App)

// E2E mode (vite --mode e2e) runs without Sentry and with stubbed auth so
// Playwright can drive the app deterministically.
const isE2E = import.meta.env.VITE_E2E === 'true'

app.use(createPinia())
app.use(router)
if (!isE2E) {
  app.use(getAuth0())
}

app.mount('#app')

// Sentry initializes after mount via a dynamic import so its bundle (tracing
// + session replay) stays off the first-paint critical path. Errors thrown
// before this resolves go unreported — an accepted trade-off.
if (!isE2E) {
  import('@sentry/vue').then((Sentry) => {
    Sentry.init({
      app,
      dsn: 'https://e5f70dd45644023807e0b6d18cb6896a@o4510748410576896.ingest.de.sentry.io/4511682260566096',
      integrations: [
        Sentry.browserTracingIntegration({ router }),
        Sentry.replayIntegration(),
        Sentry.consoleLoggingIntegration(),
      ],
      // Sampled tracing/replay: a personal mailbox does not need every
      // session recorded, and replay instruments every DOM mutation.
      tracesSampleRate: 0.2,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      // Structured Logging
      enableLogs: true,
    })
  })
}
