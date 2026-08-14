import './assets/main.css'

import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { getAuth0 } from './auth0-client'
import { registerServiceWorker } from './lib/serviceWorker'
import { initTheme } from './lib/theme'
import { scheduleIdleTask } from './lib/scheduleIdleTask'

// Apply the saved theme (and start tracking the OS for 'system') before mount
// so the first paint already carries the right data-theme — no flash.
initTheme()

const app = createApp(App)

// E2E mode (vite --mode e2e) runs without Sentry and with stubbed auth so
// Playwright can drive the app deterministically.
const isE2E = import.meta.env.VITE_E2E === 'true'

app.use(createPinia())
app.use(router)
const auth0 = isE2E ? null : getAuth0()
if (auth0) app.use(auth0)

app.mount('#app')

// Keep development and deterministic E2E runs free of persistent workers;
// production registers the offline shell and recent-mail cache after mount.
if (!isE2E) registerServiceWorker()

// Sentry is useful once the authenticated application is running, but its SDK
// is unnecessary on the logged-out page. Load it during idle time after the
// first authenticated render so it consumes neither first-paint bandwidth nor
// an early main-thread task.
if (auth0) {
  const startErrorMonitoring = () => {
    scheduleIdleTask(() => {
      import('./lib/errorMonitoring').then(({ initErrorMonitoring }) => initErrorMonitoring(app))
    })
  }

  if (auth0.isAuthenticated.value) {
    startErrorMonitoring()
  } else {
    const stop = watch(auth0.isAuthenticated, (authenticated) => {
      if (!authenticated) return
      stop()
      startErrorMonitoring()
    })
  }
}
