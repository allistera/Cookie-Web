import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// Serves /api/emails locally, where Vercel's serverless functions don't run.
// E2E mode (and dev without DATABASE_URL) answers from fixtures; otherwise the
// real Vercel handler runs against Postgres.
function localApiPlugin(mode) {
  const handleEmails = async (req, res) => {
    if (mode === 'e2e' || !process.env.DATABASE_URL) {
      const { fixtureEmails } = await import('./api/_fixtures/emails.js')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ emails: fixtureEmails() }))
      return
    }
    const { default: handler } = await import('./api/emails.js')
    await handler(req, res)
  }
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/emails', handleEmails)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/emails', handleEmails)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Expose .env values (DATABASE_URL) to the local API middleware.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [
      vue(),
      vueJsx(),
      vueDevTools(),
      localApiPlugin(mode),
    ],
    server: {
      port: 5180
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
