import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { bundleBudgetPlugin } from './scripts/bundleBudget.mjs'
import { localApiPlugin } from './scripts/localApi/plugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Expose .env values (DATABASE_URL) to the local API middleware.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [vue(), vueDevTools(), localApiPlugin(mode), bundleBudgetPlugin()],
    server: {
      port: 5180,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/components/SenderSettings.vue'],
        reporter: ['text', 'json-summary', 'lcov'],
        thresholds: {
          lines: 95,
          statements: 95,
          functions: 90,
          branches: 90,
        },
      },
    },
  }
})
