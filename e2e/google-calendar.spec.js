import { expect, test } from './workerFixtures.js'

// The Google account here is the local fixture's (scripts/localApi/fixtures/
// googleCalendar.js): "Connect Google Calendar" round-trips through the dev
// server's own callback instead of Google, exactly as the Worker's would
// bounce the browser back to Settings. Its events sit on this frozen date.
async function freezeCalendarClock(page) {
  await page.clock.setFixedTime(new Date(2026, 6, 24, 10, 30))
}

test('Google Calendar connects from Settings, shows the chosen calendars in Calendar, and edits their events', async ({
  page,
}) => {
  await freezeCalendarClock(page)
  await page.goto('/settings/calendar')

  await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible()
  await expect(page.getByText('No Google account connected.')).toBeVisible()
  await page.getByRole('button', { name: 'Connect Google Calendar' }).click()

  // Back from "Google" with the outcome consumed off the URL.
  await expect(page).toHaveURL(/\/settings\/calendar$/)
  await expect(page.getByText('person@example.com', { exact: true })).toBeVisible()
  const showPersonal = page.getByRole('checkbox', { name: 'Show person@example.com in Cookie' })
  const showTeam = page.getByRole('checkbox', { name: 'Show Team in Cookie' })
  await expect(showPersonal).not.toBeChecked()
  await showPersonal.check()
  await expect(showPersonal).toBeChecked()
  await showTeam.check()
  await expect(showTeam).toBeChecked()

  await page.goto('/calendar')
  const googleNav = page.getByRole('navigation', { name: 'Google Calendar' })
  await expect(
    googleNav.getByRole('button', { name: 'person@example.com', exact: true }),
  ).toBeVisible()
  await expect(googleNav.getByRole('button', { name: 'Team', exact: true })).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Calendars', exact: true })
      .getByRole('button', { name: 'Team' }),
  ).toHaveCount(0)

  // A writable Google event edits like any other, minus the repeat rule.
  const dentist = page.locator('.day-event', { hasText: 'Dentist' })
  await expect(dentist).toBeVisible()
  await dentist.click()
  const dialog = page.getByRole('dialog', { name: 'Edit event' })
  await expect(
    dialog.getByText('One occurrence of a repeating Google Calendar event.'),
  ).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Open in Google Calendar' })).toHaveAttribute(
    'href',
    /calendar\.google\.com/,
  )
  await expect(dialog.getByLabel('Event repeats')).toHaveCount(0)
  await dialog.getByLabel('Event title').fill('Dentist check-up')
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/calendar-events') && response.request().method() === 'PATCH',
    ),
    dialog.getByRole('button', { name: 'Save Event' }).click(),
  ])
  await expect(dialog).toBeHidden()
  await expect(page.locator('.day-event', { hasText: 'Dentist check-up' })).toBeVisible()

  // A calendar the account can only read opens read-only.
  await page
    .getByRole('group', { name: 'All-day events' })
    .getByRole('button', { name: 'Team offsite' })
    .click()
  const readOnly = page.getByRole('dialog', { name: 'Edit event' })
  await expect(readOnly.getByText('This Google calendar is read-only in Cookie.')).toBeVisible()
  await expect(readOnly.getByRole('button', { name: 'Save Event' })).toHaveCount(0)
  await readOnly.locator('.new-event-cancel').click()
  await expect(readOnly).toBeHidden()

  // New events can be filed on a writable Google calendar.
  await page.getByRole('button', { name: 'New event' }).click()
  await page.getByRole('button', { name: 'Advanced' }).click()
  const create = page.getByRole('dialog', { name: 'New event' })
  await create.getByLabel('Event title').fill('Coffee with Sam')
  await create.getByLabel('Event calendar').selectOption({ label: 'person@example.com' })
  await expect(
    create.getByText('Repeats for Google Calendar events are set in Google Calendar.'),
  ).toBeVisible()
  await expect(create.getByLabel('Event repeats')).toHaveCount(0)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/calendar-events') && response.request().method() === 'POST',
    ),
    create.getByRole('button', { name: 'Create Event' }).click(),
  ])
  await expect(create).toBeHidden()
  await expect(page.locator('.day-event', { hasText: 'Coffee with Sam' })).toBeVisible()

  // Disconnecting takes the calendars (and their events) out of Cookie.
  await page.goto('/settings/calendar')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm disconnect' }).click()
  await expect(page.getByText('No Google account connected.')).toBeVisible()
  await page.goto('/calendar')
  await expect(page.getByRole('navigation', { name: 'Google Calendar' })).toHaveCount(0)
  await expect(page.locator('.day-event', { hasText: 'Dentist check-up' })).toHaveCount(0)
})
