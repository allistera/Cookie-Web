import { readFileSync } from 'node:fs'

import { expect, test as base } from './workerFixtures.js'

// Keep this guard on successful smoke flows: other E2E specs deliberately
// exercise failing requests. Attach before navigation and assert at teardown
// so startup, navigation, and late errors during the flow are all checked.
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`))

    await use(page)

    expect(errors, 'The page must not emit console errors or uncaught exceptions').toEqual([])
  },
})

const routes = [
  ['Today', '/', '.ai-today-view', '[data-testid="todo-card"]'],
  ['Inbox', '/inbox', '#traditionalInboxView', '.ni-row'],
  ['Calendar', '/calendar', '.calendar-view', '.calendar-list-item'],
  ['Documents', '/documents', '.documents-view', '.browser-item'],
  ['Tasks', '/tasks?project=inbox', '.tasks-view', '.add-task-btn'],
  ['Settings', '/settings/calendar', '.settings-page', '.calendar-settings-row'],
]

for (const [name, path, view, ready] of routes) {
  test(`${name} loads without console errors`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator(view)).toBeVisible()
    await expect(page.locator(ready).first()).toBeVisible()
    await expect(page.locator('.tasks-loading')).toBeHidden()
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    )
  })
}

test('switching apps produces no console errors', async ({ page }) => {
  await page.goto('/inbox')
  await expect(page.locator('.ni-row').first()).toBeVisible()

  for (const [app, view] of [
    ['Calendar', '.calendar-view'],
    ['Documents', '.documents-view'],
    ['Tasks', '.tasks-view'],
    ['Email', '.ai-today-view'],
  ]) {
    await page.getByRole('button', { name: 'Switch Cookie app' }).hover()
    await page.getByRole('menuitem', { name: app, exact: true }).click()
    await page.mouse.move(0, 400)
    await expect(page.locator('.logo-suffix')).toHaveText(app)
    await expect(page.locator(view)).toBeVisible()
  }
})

test('the production CSP permits the injected Vercel Toolbar script without console errors', async ({
  page,
}) => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const pages = config.headers.find((entry) => entry.source === '/((?!api/).*)')
  const toolbarUrl = 'https://vercel.live/_next-live/feedback/feedback.js'

  // E2E preview does not apply Vercel headers or inject its toolbar. Use the
  // actual deployment headers on a small page and stub only the remote script
  // response, so the browser still enforces CSP for the real toolbar URL.
  await page.route('**/__e2e__/toolbar-console-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: Object.fromEntries(pages.headers.map(({ key, value }) => [key, value])),
      body: `<!doctype html><html><head><meta charset="UTF-8"></head><body>
        <p id="toolbar-status" role="status">Loading toolbar</p>
        <script defer src="${toolbarUrl}"></script>
      </body></html>`,
    }),
  )
  await page.route(toolbarUrl, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "document.getElementById('toolbar-status').textContent = 'Toolbar loaded'",
    }),
  )

  await page.goto('/__e2e__/toolbar-console-check')
  await expect(page.getByRole('status')).toHaveText('Toolbar loaded')
})
