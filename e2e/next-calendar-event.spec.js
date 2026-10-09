import { expect, test } from './workerFixtures.js'
import { CALENDAR_API_URL } from '../src/lib/apiWorkers.js'

test('Mail shows today’s next event beside the tabs, then hides it when no events remain', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 9, 16, 2) })
  let events = [
    { id: 'next', title: 'Sprint planning', date: '2026-10-09', start: '16:30', duration: 30 },
    { id: 'past', title: 'Earlier meeting', date: '2026-10-09', start: '15:00', duration: 30 },
  ]
  await page.route(`${CALENDAR_API_URL}/calendar-events?*`, (route) =>
    route.fulfill({ json: { events } }),
  )
  await page.goto('/inbox')
  const chip = page.locator('.next-calendar-event')
  await expect(chip).toContainText('Sprint planning')
  await expect(chip).toContainText('16:30')
  await expect(chip).toContainText('in 28 min')
  await page.getByRole('tab', { name: /^Other/ }).click()
  await expect(chip).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(chip).toBeInViewport()
  await expect(page.getByRole('tab', { name: /^Important/ })).toBeVisible()
  events = []
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(chip).toBeHidden()
})
