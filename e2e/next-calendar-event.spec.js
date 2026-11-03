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

test('clicking the next event opens its entry in Calendar', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 9, 16, 2))
  await page.route(`${CALENDAR_API_URL}/calendar-events?*`, (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 'series-2026-10-09',
            seriesId: 'series',
            seriesDate: '2026-10-02',
            title: 'Sprint planning',
            date: '2026-10-09',
            start: '16:30',
            duration: 30,
            calendar: 'work',
            recurrenceRule: 'FREQ=WEEKLY',
          },
        ],
      },
    }),
  )
  await page.goto('/inbox')
  await page.getByRole('link', { name: /Next event: Sprint planning/ }).click()
  await expect(page).toHaveURL(/\/calendar\?date=2026-10-09&event=series-2026-10-09/)
  await expect(page.locator('.day-calendar > h2')).toContainText('9')
  await expect(page.getByRole('textbox', { name: 'Event title', exact: true })).toHaveValue(
    'Sprint planning',
  )
  await expect(page.locator('.new-event-dialog input[type="time"]').first()).toHaveValue('16:30')
})

test("AI Today lists today's events in a card above the to-dos", async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 9, 16, 2))
  await page.route(`${CALENDAR_API_URL}/calendar-events?*`, (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 'next',
            title: 'Sprint planning',
            date: '2026-10-09',
            start: '16:30',
            duration: 30,
            calendar: 'work',
          },
          {
            id: 'past',
            title: 'Earlier meeting',
            date: '2026-10-09',
            start: '15:00',
            duration: 30,
            calendar: 'personal',
          },
          {
            id: 'offsite',
            title: 'Company offsite',
            date: '2026-10-09',
            start: '00:00',
            duration: 1440,
            allDay: true,
            calendar: 'holidays',
          },
        ],
      },
    }),
  )
  await page.goto('/')

  const card = page.getByTestId('events-card')
  await expect(card.getByRole('heading', { name: "Today's Events" })).toBeVisible()
  await expect(page.locator('.ai-card').first()).toHaveAttribute('data-testid', 'events-card')
  const rows = card.locator('.todo-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('All day')
  await expect(rows.nth(0)).toContainText('Company offsite')
  await expect(rows.nth(0)).toContainText('Holidays')
  await expect(rows.nth(1)).toContainText('15:00 – 15:30')
  await expect(rows.nth(1)).toHaveClass(/event-row-past/)
  await expect(rows.nth(2)).toContainText('16:30 – 17:00')
  await expect(rows.nth(2)).toContainText('Work')

  await card.getByRole('link', { name: 'Open in Calendar: Sprint planning' }).click()
  await expect(page).toHaveURL(/\/calendar\?date=2026-10-09&event=next/)
  await expect(page.getByRole('textbox', { name: 'Event title', exact: true })).toHaveValue(
    'Sprint planning',
  )
})
