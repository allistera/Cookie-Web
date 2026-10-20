import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { getAuth0 } from './auth0-client'
import { installConnectivityListeners } from './lib/connectivity'
import { registerServiceWorker } from './lib/serviceWorker'
import { installStaleChunkReload } from './lib/staleChunkReload'
import { initTheme } from './lib/theme'
import { initSentry } from './lib/sentry'

// Apply the saved theme (and start tracking the OS for 'system') before mount
// so the first paint already carries the right data-theme — no flash.
initTheme()

// A tab left open across a deploy references chunks that no longer exist;
// reload once so it picks up the current bundle instead of erroring.
installStaleChunkReload()

// Online/offline events feed the offline banner and the outbox replay.
installConnectivityListeners()

const app = createApp(App)

// E2E mode (vite --mode e2e) runs with stubbed auth so Playwright can drive
// the app deterministically.
const isE2E = import.meta.env.VITE_E2E === 'true'

app.use(createPinia())
app.use(router)
const auth0 = isE2E ? null : getAuth0()
// The SDK's first token request goes to the tenant as soon as the app mounts;
// open that connection now rather than when the request is built.
const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN
if (auth0 && auth0Domain) {
  const hint = document.createElement('link')
  hint.rel = 'preconnect'
  hint.href = `https://${auth0Domain}`
  hint.crossOrigin = ''
  document.head.append(hint)
}
if (auth0) app.use(auth0)

// Install the temporary error handler synchronously, but never wait for the
// optional SDK download before rendering the inbox or starting offline support.
void initSentry(app)
app.mount('#app')

// Keep development and deterministic E2E runs free of persistent workers.
if (!isE2E) registerServiceWorker()
