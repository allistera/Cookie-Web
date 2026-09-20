import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { getAuth0 } from './auth0-client'
import { registerServiceWorker } from './lib/serviceWorker'
import { installStaleChunkReload } from './lib/staleChunkReload'
import { initTheme } from './lib/theme'

// Apply the saved theme (and start tracking the OS for 'system') before mount
// so the first paint already carries the right data-theme — no flash.
initTheme()

// A tab left open across a deploy references chunks that no longer exist;
// reload once so it picks up the current bundle instead of erroring.
installStaleChunkReload()

const app = createApp(App)

// E2E mode (vite --mode e2e) runs with stubbed auth so Playwright can drive
// the app deterministically.
const isE2E = import.meta.env.VITE_E2E === 'true'

app.use(createPinia())
app.use(router)
const auth0 = isE2E ? null : getAuth0()
if (auth0) app.use(auth0)

app.mount('#app')

// Keep development and deterministic E2E runs free of persistent workers;
// production registers the offline shell and recent-mail cache after mount.
if (!isE2E) registerServiceWorker()
