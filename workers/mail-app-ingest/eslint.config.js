import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import js from '@eslint/js'

export default defineConfig([
  {
    name: 'worker/files-to-lint',
    files: ['**/*.js'],
  },

  globalIgnores(['**/node_modules/**', '**/.wrangler/**', '**/coverage/**']),

  {
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },

  js.configs.recommended,
])
