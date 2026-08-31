import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Maximum time one test can run for. */
  timeout: 30 * 1000,
  expect: {
    /* Maximum time expect() should wait for the condition to be met. */
    timeout: 5000,
  },
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5180',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  // Chromium only. Firefox and WebKit were dropped for run time: they tripled
  // the e2e wall clock, and WebKit alone was longer than the other two put
  // together. The cost is real — a scheduling bug once failed on Firefox and
  // WebKit while Chromium passed — so a cross-browser check is now a
  // deliberate act: add the project back, or run `npx playwright test
  // --project=webkit` after `npx playwright install webkit`.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /* Run your local dev server before starting the tests */
  webServer: {
    /**
     * Use the dev server by default for faster feedback loop.
     * Use the preview server on CI for more realistic testing.
     * Playwright will re-use the local server if there is already a dev-server running.
     */
    command: process.env.CI
      ? 'npm run build -- --mode e2e && npm run preview -- --mode e2e'
      : 'npm run dev -- --mode e2e',
    port: process.env.CI ? 4173 : 5180,
    reuseExistingServer: !process.env.CI,
  },
})
