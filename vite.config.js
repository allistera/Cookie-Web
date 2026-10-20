import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { bundleBudgetPlugin } from './scripts/bundleBudget.mjs'
import { localApiPlugin } from './scripts/localApi/plugin.js'
import { sentryBuildConfig } from './scripts/sentryBuild.js'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  // Expose .env values (DATABASE_URL) to the local API middleware.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  const sentry = sentryBuildConfig(process.env, command, mode)

  return {
    define: command === 'build' ? sentry.define : undefined,
    build: {
      sourcemap: sentry.upload ? 'hidden' : false,
      // Native module preloads avoid shipping a legacy preload-only shim.
      // Browsers without preload support still load native ES modules.
      modulePreload: { polyfill: false },
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'browser-core',
                test: /node_modules[\\/](@vue|vue|pinia|dompurify)[\\/]/u,
                tags: ['$initial'],
                priority: 20,
              },
              {
                // Consolidate existing startup dependencies so per-chunk
                // Sentry debug IDs fit within the unchanged bundle budgets.
                name: 'app-shared',
                test: fileURLToPath(new URL('./src/', import.meta.url)),
                tags: ['$initial'],
                minShareCount: 2,
                includeDependenciesRecursively: false,
              },
            ],
          },
        },
      },
    },
    plugins: [
      vue(),
      vueDevTools(),
      localApiPlugin(mode),
      bundleBudgetPlugin(),
      sentry.upload && sentryVitePlugin(sentry.pluginOptions),
    ],
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
        include: ['src/components/SenderSettings.vue', 'src/views/TraditionalInboxView.vue'],
        reporter: ['text', 'json-summary', 'lcov'],
        thresholds: {
          perFile: true,
          lines: 95,
          statements: 95,
          functions: 90,
          branches: 90,
        },
      },
    },
  }
})
