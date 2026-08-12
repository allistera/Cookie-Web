import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { getAuth0 } from './auth0-client'
import { registerServiceWorker } from './lib/serviceWorker'
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

// Keep development and deterministic E2E runs free of persistent workers;
// production registers the offline shell and recent-mail cache after mount.
if (!isE2E) registerServiceWorker()

// Sentry initializes after mount via a dynamic import so its SDK stays off the
// first-paint critical path. Only error reporting is configured: no tracing,
// Session Replay, or Sentry Logs.
if (!isE2E) {
  import('./lib/errorMonitoring').then(({ initErrorMonitoring }) => initErrorMonitoring(app))
}
