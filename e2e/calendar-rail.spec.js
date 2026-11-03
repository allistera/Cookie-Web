import { expect, test } from './workerFixtures.js'
import { CALENDAR_API_URL } from '../src/lib/apiWorkers.js'

const EVENTS = [
  {
    id: 'standup',
    title: 'Team standup',
    date: '2026-11-03',
    start: '09:30',
    duration: 15,
    calendar: 'work',
  },
  {
    id: 'lunch',
    title: 'Lunch with Sam',
    date: '2026-11-03',
    start: '12:30',
    duration: 60,
    calendar: 'work',
    location: 'Bread Meats Bread',
  },
  {
    id: 'call',
    title: 'Call with Rachel Ward',
    date: '2026-11-03',
    start: '15:00',
    duration: 30,
    calendar: 'work',
    description: 'Join: https://zoom.us/j/88123345',
  },
  {
    id: 'review',
    title: 'Code review',
    date: '2026-11-03',
    start: '15:00',
    duration: 45,
    calendar: 'work',
  },
  {
    id: 'bins',
    title: 'Bin collection',
    date: '2026-11-03',
    start: '00:00',
    duration: 1440,
    allDay: true,
    calendar: 'work',
  },
]

test('the calendar sidebar is closed by default, opens from the header, and stays open', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 10, 3, 13, 47))
  await page.route(`${CALENDAR_API_URL}/calendar-events?*`, (route) => {
    const from = new URL(route.request().url()).searchParams.get('from')
    route.fulfill({ json: { events: EVENTS.filter((event) => event.date === from) } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/inbox')

  const rail = page.getByRole('complementary', { name: 'Calendar' })
  const toggle = page.getByRole('button', { name: 'Show calendar' })
  await expect(rail).toBeHidden()
  await expect(page.locator('.next-calendar-event')).toBeVisible()

  await toggle.click()
  await expect(rail).toBeVisible()
  await expect(rail).toContainText('Today')
  await expect(rail.locator('.cr-up-next')).toContainText('in 1 hr 13 min')
  await expect(rail.locator('.cr-all-day-chip')).toHaveText('Bin collection')
  await expect(rail.locator('.cr-event', { hasText: 'Lunch with Sam' })).toBeVisible()
  // The rail's Up next replaces the inbox chip while it is open.
  await expect(page.locator('.next-calendar-event')).toBeHidden()

  await rail.locator('.cr-event', { hasText: 'Call with Rachel Ward' }).click()
  const details = rail.getByRole('dialog', { name: 'Event details' })
  await expect(details.getByRole('link', { name: 'Join' })).toHaveAttribute(
    'href',
    'https://zoom.us/j/88123345',
  )
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()

  // Remembered in this browser across a reload, and on Tasks too.
  await page.reload()
  await expect(rail).toBeVisible()
  await page.goto('/tasks')
  await expect(rail).toBeVisible()

  await page.keyboard.press(']')
  await expect(rail).toBeHidden()
  await page.reload()
  await expect(rail).toBeHidden()
})
