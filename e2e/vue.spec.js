import { expect, test } from './workerFixtures.js'

import {
  AI_API_URL,
  DRAFTS_API_URL,
  EMAILS_API_URL,
  MESSAGES_API_URL,
  TASKS_API_URL,
} from '../src/lib/apiWorkers.js'

// The app calls its Cloudflare Workers at absolute cross-origin URLs
// (src/lib/apiWorkers.js), which nothing same-origin can intercept.
// e2e/workerFixtures.js routes every Worker origin back to the dev/preview
// server's /__e2e__/* fixture handlers, so a test only needs its own route()
// stub for the specific response it wants to control.
//
// Stub those against the URL the app actually calls, built from the same
// constant the app imports — never a hand-written '/api/...' path. Seven specs
// silently broke that way: each endpoint moved to a Worker, the stubs kept
// matching the retired same-origin URL, and so never fired at all.

// The calendar fixture (api/_fixtures/calendarEvents.js) and CalendarView.vue's
// "today" both used to be pinned to this date; CalendarView now reads the real
// clock, so freeze it here instead of drifting the fixture and every date
// assertion below along with the real calendar. Must run before the first
// navigation so it's in effect from the page's very first script.
async function freezeCalendarClock(page) {
  await page.clock.setFixedTime(new Date(2026, 6, 24, 10, 30))
}

// The relative-day schedule options collapse onto each other depending on
// which day it is: 'Next Week' means the coming Monday, so on a Sunday it is
// the same day as 'Tomorrow', and 'This weekend' is 'Tomorrow' on a Friday.
// A test that pairs two of them then sets a reminder on top of its own
// scheduled send, which the app rightly refuses. Freezing to a Wednesday —
// where Tomorrow, This weekend and Next Week are three distinct days — is what
// keeps such a test from depending on the day it happens to run.
async function freezeClockToMidweek(page) {
  await page.clock.setFixedTime(new Date(2026, 7, 26, 10, 30))
}

test('The header app switcher opens the interactive Calendar views and returns to Email', async ({
  page,
}) => {
  await freezeCalendarClock(page)
  await page.goto('/')

  const trigger = page.getByRole('button', { name: 'Switch Cookie app' })
  const suffix = page.locator('.logo-suffix')
  await expect(suffix).toHaveText('Email')

  const calendarLink = page.getByRole('menuitem', { name: 'Calendar' })
  await expect(calendarLink).toBeHidden()
  await trigger.hover()
  await expect(calendarLink).toBeVisible()
  await calendarLink.click()

  await expect(page).toHaveURL(/\/calendar$/)
  // The switcher menu is hover-driven and the pointer is still parked on it;
  // park the mouse elsewhere so the open menu can't intercept later clicks on
  // content beneath it (the Tasks item reaches the calendar sidebar).
  await page.mouse.move(0, 400)
  await expect(suffix).toHaveText('Calendar')
  await expect(page.locator('.calendar-view')).toBeVisible()
  const calendarSidebar = page.getByRole('complementary', { name: 'Calendar sidebar' })
  await expect(calendarSidebar).toBeVisible()
  await expect(calendarSidebar.getByRole('navigation', { name: 'Calendars' })).toBeVisible()
  await expect(calendarSidebar.getByRole('link', { name: 'Manage calendars' })).toBeVisible()
  const workCalendar = calendarSidebar.getByRole('button', { name: 'Work', exact: true })
  await expect(workCalendar).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.search-bar-container')).toHaveCount(1)
  await expect(
    page.getByRole('heading', { name: 'Friday, July 24, 2026', exact: true }),
  ).toHaveCount(2)
  await expect(page.locator('.day-event', { hasText: 'Standup' })).toBeVisible()
  await workCalendar.click()
  await expect(page.locator('.day-event', { hasText: 'Standup' })).toHaveCount(0)
  await expect(page.locator('.day-event', { hasText: 'Coffee with Sam' })).toBeVisible()
  await workCalendar.click()
  await expect(page.locator('.day-event', { hasText: 'Standup' })).toBeVisible()

  await page.getByRole('button', { name: 'Week', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Jul 20 – 26, 2026' })).toBeVisible()
  await expect(page.locator('.week-calendar')).toBeVisible()

  await page.getByRole('button', { name: 'Month', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'July 2026' })).toBeVisible()
  await expect(page.locator('.month-event', { hasText: 'Client call — Meridian' })).toBeVisible()

  await page.locator('.calendar-page .new-event-button').click()
  const dialog = page.getByRole('dialog', { name: 'New event' })
  await expect(dialog).toBeVisible()
  // The dialog opens in AI mode (describe-it-in-words); the manual fields
  // live behind the Advanced button.
  const aiInput = dialog.getByRole('textbox', { name: 'Describe your event' })
  await expect(aiInput).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'Create Event' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Advanced' }).click()
  const titleInput = dialog.getByRole('textbox', { name: 'Event title' })
  await expect(titleInput).toHaveAttribute('placeholder', 'New event')
  await expect(titleInput).toBeFocused()
  await expect(dialog.getByRole('textbox', { name: 'Event description' })).toHaveAttribute(
    'placeholder',
    'Tell Cookie what you need — it fills in the rest',
  )
  await expect(dialog.getByPlaceholder('Add location')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Create Event' })).toBeDisabled()
  await titleInput.fill('Lunch with Mia')
  await dialog.getByRole('button', { name: 'Create Event' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.month-event', { hasText: 'Lunch with Mia' })).toBeVisible()

  const emailLink = page.getByRole('menuitem', { name: 'Email' })
  await trigger.hover()
  await expect(emailLink).toBeVisible()
  await emailLink.click()

  await expect(page).toHaveURL(/\/$/)
  await expect(suffix).toHaveText('Email')
  await expect(page.locator('.left-sidebar')).toBeVisible()
})

test('The header notification count opens the section that raised the first notification', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/documents')

  const notificationButton = page.getByRole('button', {
    name: /Open \d+ notifications?: \d+ unread emails?/,
  })
  await expect(notificationButton).toBeVisible()

  const count = await notificationButton.locator('.header-notification-count').textContent()
  expect(Number(count)).toBeGreaterThan(0)

  await notificationButton.click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('.nav-item', { hasText: 'Inbox' }).locator('.nav-badge')).toHaveText(
    count,
  )
})

test('Calendar settings manages subscriptions that appear in the Calendar view', async ({
  page,
}) => {
  await freezeCalendarClock(page)
  await page.goto('/settings/calendar')

  await expect(page.getByRole('heading', { name: 'Calendars', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible()
  await page.getByRole('button', { name: 'Add subscription', exact: true }).click()
  await page.getByRole('textbox', { name: 'New calendar name' }).fill('Team Feed')
  await page
    .getByRole('textbox', { name: 'Calendar subscription URL' })
    .fill('https://example.com/team.ics')
  await page
    .locator('.calendar-settings-create')
    .getByRole('button', { name: 'Add subscription' })
    .click()

  await expect(page.locator('.calendar-settings-row', { hasText: 'Team Feed' })).toBeVisible()
  const syncNow = page.getByRole('button', { name: 'Sync Team Feed' })
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/calendars') && response.request().method() === 'POST',
    ),
    syncNow.click(),
  ])
  await expect(syncNow).toBeEnabled()

  await page.goto('/calendar')
  const calendars = page.getByRole('navigation', { name: 'Calendars', exact: true })
  const subscribed = page.getByRole('navigation', { name: 'Subscribed calendars' })
  await expect(calendars.getByRole('button', { name: 'Work', exact: true })).toBeVisible()
  await expect(subscribed.getByRole('button', { name: 'Team Feed', exact: true })).toBeVisible()
  await expect(calendars.getByRole('button', { name: 'Team Feed', exact: true })).toHaveCount(0)

  const syncedEvent = page.locator('.day-event', { hasText: 'Synced from subscription' })
  await expect(syncedEvent).toBeVisible()
})

test('All-day events stay below the date header and outside the hourly lane', async ({ page }) => {
  await freezeCalendarClock(page)
  await page.goto('/calendar')

  const dateHeader = page.locator('.day-calendar > h2')
  const allDayRow = page.getByRole('group', { name: 'All-day events' })
  const holiday = allDayRow.getByRole('button', { name: 'Company Holiday' })
  const timeline = page.locator('.day-timeline')

  await expect(holiday).toBeVisible()
  await expect(page.locator('.day-event', { hasText: 'Company Holiday' })).toHaveCount(0)

  const [headerBox, rowBox, timelineBox] = await Promise.all([
    dateHeader.boundingBox(),
    allDayRow.boundingBox(),
    timeline.boundingBox(),
  ])
  expect(rowBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1)
  expect(timelineBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1)
})

test('Clicking an event opens it prefilled for editing, with a Delete button', async ({ page }) => {
  await freezeCalendarClock(page)
  await page.goto('/calendar')
  await expect(page.locator('h1')).toHaveText('Friday, July 24, 2026')

  await page.locator('.day-event', { hasText: 'Standup' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit event' })
  await expect(dialog).toBeVisible()

  const titleInput = dialog.getByRole('textbox', { name: 'Event title' })
  await expect(titleInput).toHaveValue('Standup')
  await expect(dialog.locator('input[type="date"]')).toHaveValue('2026-07-24')
  const timeInputs = dialog.locator('input[type="time"]')
  await expect(timeInputs.nth(0)).toHaveValue('09:00')
  await expect(timeInputs.nth(1)).toHaveValue('09:30')
  await expect(dialog.getByRole('button', { name: 'Save Event' })).toBeVisible()

  await titleInput.fill('Daily Standup')
  await dialog.getByRole('button', { name: 'Save Event' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.day-event', { hasText: 'Daily Standup' })).toBeVisible()

  await page.locator('.day-event', { hasText: 'Daily Standup' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.day-event', { hasText: 'Daily Standup' })).toHaveCount(0)
})

test('Dragging on the day timeline opens New event with the date, start, and end pre-filled', async ({
  page,
}) => {
  await freezeCalendarClock(page)
  await page.goto('/calendar')
  await expect(page.locator('h1')).toHaveText('Friday, July 24, 2026')

  // The page header and insight cards push the hourly grid below the fold at the default
  // viewport size, so scroll the 11 AM-12 PM slot into view before computing coordinates.
  await page.evaluate(() => {
    document.querySelector('.calendar-content').scrollTop = 400
  })

  const lane = page.locator('.day-event-lane')
  const box = await lane.boundingBox()
  const x = box.x + box.width / 2

  // DAY_HOUR_HEIGHT is 96px/hour starting at 8 AM: +288 -> 11:00 AM, +384 -> 12:00 PM.
  // (11 AM-12 PM is clear of the seeded Standup and Coffee with Sam events.)
  await page.mouse.move(x, box.y + 288)
  await page.mouse.down()
  await page.mouse.move(x, box.y + 384)
  await page.mouse.up()

  const dialog = page.getByRole('dialog', { name: 'New event' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input[type="date"]')).toHaveValue('2026-07-24')
  const timeInputs = dialog.locator('input[type="time"]')
  await expect(timeInputs.nth(0)).toHaveValue('11:00')
  await expect(timeInputs.nth(1)).toHaveValue('12:00')

  await dialog.getByRole('textbox', { name: 'Event title' }).fill('Dentist appointment')
  await dialog.getByRole('button', { name: 'Create Event' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.day-event', { hasText: 'Dentist appointment' })).toBeVisible()
})

test('Calendar uses the saved dark theme across the canvas, sidebar, and dialog', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cookie-theme', 'dark'))
  await page.goto('/calendar')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const palette = await page.locator('.calendar-view').evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, color: style.color }
  })
  expect(palette).toEqual({ background: 'rgb(16, 17, 19)', color: 'rgb(247, 248, 248)' })

  const sidebar = page.getByRole('complementary', { name: 'Calendar sidebar' })
  await expect(sidebar).toHaveCSS('background-color', 'rgb(16, 17, 19)')
  await sidebar.getByRole('button', { name: 'New event', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New event' })).toHaveCSS(
    'background-color',
    'rgb(23, 24, 27)',
  )
})

test('The root path shows AI Today to-dos, email triage, and news', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  // Two built-in tasks and one email follow-up, all really gathered.
  await expect(page.getByRole('heading', { name: /Hi Allister/ })).toContainText('3 to-dos')

  // Sidebar labels this view "AI Today".
  await expect(page.locator('.nav-item', { hasText: 'AI Today' })).toBeVisible()

  // Staleness comes from the newest gathered_at, not a hardcoded string.
  await expect(page.locator('.status-time')).toHaveText('Updated 3h ago')
  await expect(page.locator('.ai-update-status')).toHaveCount(0)

  // One list, ordered as the API returned it, with a bold title and description.
  const todos = page.getByTestId('task-rows')
  await expect(todos.locator('.todo-row')).toHaveCount(3)
  const firstTask = todos.locator('.todo-row').first()
  await expect(firstTask.locator('strong')).toHaveText('Renew car insurance')
  await expect(firstTask).toContainText('Renew car insurance – Policy lapses on Friday')
  await expect(firstTask).toContainText('From: Tasks')
  await expect(firstTask.locator('a.action-pill-btn')).toHaveAttribute(
    'href',
    '/tasks?project=today&task=stub-task-1',
  )

  // Email action items offer a one-click, editable follow-up draft.
  const emailTask = todos.locator('.todo-row', { hasText: 'Confirm the revised floor plan' })
  await expect(emailTask).toContainText('From: Email')
  await emailTask.locator('.action-pill-btn', { hasText: 'Draft' }).click()
  const composer = page.locator('#composerToast')
  await expect(composer).toHaveClass(/active/)
  await expect(composer.locator('.composer-to-inline')).toHaveValue('updates@cityconstruction.com')
  await expect(composer.locator('.composer-subject-inline')).toHaveValue(
    'Re: Revised Floor Plan - Natural Light adjustments',
  )
  await expect(composer.locator('.composer-editor')).toContainText(
    'A reviewable AI-generated draft.',
  )

  // Reply Needed and Review become rows; Noise is summarized without listing
  // individual emails. Scope to the triage card because news shares styles.
  const triage = page.getByTestId('topic-sections')
  await expect(triage.locator('.topic-title')).toHaveCount(2)
  const replyNeeded = triage.locator('.topic-section').first()
  await expect(replyNeeded.locator('.topic-title')).toContainText('↩️ Reply Needed')
  await expect(replyNeeded).toContainText(
    'Contractor needs the floor-plan choice – The bay-window option needs a decision.',
  )
  await expect(replyNeeded.locator('.topic-meta')).toContainText('2 sources')
  await expect(replyNeeded.locator('.unread-dot')).toHaveCount(2)
  const noise = page.getByTestId('triage-noise')
  await expect(noise).toContainText('4 emails classified as Noise')
  await expect(noise).toContainText('3 marketing · 1 automated')
  await expect(noise).toContainText('nothing was archived or deleted')

  // The news round-up sits in its own card beneath the mail topics.
  const news = page.getByTestId('news-sections')
  await expect(news.locator('.topic-section')).toHaveCount(3)
  await expect(news.locator('.topic-title').nth(2)).toContainText('📰 UK headlines')
  const repo = news.locator('.topic-section').first().locator('a.news-link')
  await expect(repo).toHaveAttribute('href', 'https://github.com/acme/rocket')
  await expect(repo).toHaveAttribute('target', '_blank')
  await expect(news.locator('.news-note').first()).toContainText('Cloudflare Workers')
})

// These Worker-origin stubs observe one request and let the rest through.
// The pass-through must be route.fallback(), not route.continue(): continue()
// puts the request on the network, where the real Worker 401s an
// unauthenticated e2e run. fallback() hands it to the next matching handler —
// workerFixtures.js's context route, which serves it from the local fixtures.
test('Settings Personalisation pane adds and removes news topics', async ({ page }) => {
  const saved = []
  await page.route(`${TASKS_API_URL}/tasks/interests`, async (route) => {
    if (route.request().method() === 'PUT') saved.push(route.request().postDataJSON())
    await route.fallback()
  })

  await page.goto('/')
  await page.locator('.profile-container').click()
  await page.locator('.dropdown-menu-btn', { hasText: 'Settings' }).click()
  await page.locator('.settings-nav-item', { hasText: 'Personalisation' }).click()

  const pane = page.getByTestId('personalisation-section')
  await expect(pane).toContainText('UK headlines are never filtered')
  await expect(page.getByTestId('interest-chips').locator('.interest-chip')).toHaveCount(3)

  await pane.locator('.interest-add input').fill('Postgres')
  await pane.locator('.interest-add button', { hasText: 'Add' }).click()

  await expect(page.getByTestId('interest-chips').locator('.interest-chip')).toHaveCount(4)
  expect(saved.at(-1)).toEqual({
    interests: ['Cloudflare Workers', 'Vue', 'self-hosting', 'Postgres'],
  })
})

test('Settings AI Today pane changes the enrichment model and schedule', async ({ page }) => {
  const saved = []
  await page.route(`${TASKS_API_URL}/tasks/enrichment-settings`, async (route) => {
    if (route.request().method() === 'PUT') saved.push(route.request().postDataJSON())
    await route.fallback()
  })

  await page.goto('/settings/ai-today')
  const pane = page.getByTestId('ai-today-settings-section')
  await expect(pane).toContainText('Europe/London')
  await expect(pane.getByLabel('AI Today model')).toHaveValue('gpt-5-nano')
  await expect(pane.getByLabel('Schedule start time')).toHaveValue('9')
  await expect(pane.getByLabel('Schedule end time')).toHaveValue('19')

  await pane.getByLabel('AI Today model').selectOption('gpt-4.1-nano')
  await pane.getByLabel('Schedule interval').selectOption('3')
  await pane.getByRole('button', { name: 'Save' }).click()

  await expect(page.locator('.toast', { hasText: 'AI Today settings saved.' })).toBeVisible()
  expect(saved.at(-1).enrichmentSettings).toMatchObject({
    model: 'gpt-4.1-nano',
    schedule: { startHour: 9, endHour: 19, intervalHours: 3 },
  })

  await page.reload()
  await expect(pane.getByLabel('AI Today model')).toHaveValue('gpt-4.1-nano')
  await expect(pane.getByLabel('Schedule interval')).toHaveValue('3')
})

test('Settings Spam pane changes how long spam is kept, and the change survives a reload', async ({
  page,
}) => {
  const saved = []
  await page.route(`${EMAILS_API_URL}/emails/spam-retention`, async (route) => {
    if (route.request().method() === 'PUT') saved.push(route.request().postDataJSON())
    await route.fallback()
  })

  await page.goto('/settings/spam')
  const pane = page.getByTestId('spam-section')
  await expect(pane).toContainText('The default is 30 days')
  const input = pane.locator('input[type="number"]')
  await expect(input).toHaveValue('30')
  const save = pane.locator('button', { hasText: 'Save' })
  await expect(save).toBeDisabled()

  await input.fill('14')
  await expect(save).toBeEnabled()
  await save.click()

  await expect(
    page.locator('.toast', { hasText: 'Spam will be deleted after 14 days.' }),
  ).toBeVisible()
  expect(saved).toEqual([{ spamRetentionDays: 14 }])

  await page.reload()
  await expect(page.getByTestId('spam-section').locator('input[type="number"]')).toHaveValue('14')
})

test('AI Inbox: a triage row links through to its own email', async ({ page }) => {
  await page.goto('/')

  const firstRow = page.getByTestId('topic-sections').locator('.topic-email-row').first()
  await firstRow.locator('.email-link').click()

  await expect(page).toHaveURL(/\/inbox\?open=fixture-1/)
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()
  await expect(reader.locator('.ni-reader-subject-text')).toHaveText(
    'Revised Floor Plan - Natural Light adjustments',
  )
})

test('Marking a triage group read clears its unread dots', async ({ page }) => {
  const reads = []
  await page.route(`${MESSAGES_API_URL}/messages`, async (route) => {
    if (route.request().method() === 'PATCH') {
      reads.push(route.request().postDataJSON())
      await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
      return
    }
    await route.fallback()
  })

  await page.goto('/')
  const replyNeeded = page.getByTestId('topic-sections').locator('.topic-section').first()
  await expect(replyNeeded.locator('.unread-dot')).toHaveCount(2)

  await replyNeeded.locator('.topic-action-btn', { hasText: 'Mark all emails as read' }).click()

  await expect(replyNeeded.locator('.unread-dot')).toHaveCount(0)
  await expect(page.locator('.toast', { hasText: 'Marked 2 emails read.' })).toBeVisible()
  expect(reads).toEqual([
    { id: 'fixture-1', is_unread: false },
    { id: 'fixture-3', is_unread: false },
  ])
  // With nothing left unread the action retires itself.
  await expect(replyNeeded.locator('.topic-action-btn')).toHaveCount(0)
})

test('Marking a built-in task done removes it from AI Today and confirms with a toast', async ({
  page,
}) => {
  const completions = []
  await page.route(`${TASKS_API_URL}/tasks`, async (route) => {
    if (route.request().method() === 'POST') {
      completions.push(route.request().postDataJSON())
      await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
      return
    }
    await route.fallback()
  })

  await page.goto('/')
  const todos = page.getByTestId('task-rows')
  const firstTask = todos.locator('.todo-row').first()
  await expect(firstTask.locator('strong')).toHaveText('Renew car insurance')
  await expect(todos.locator('.todo-row')).toHaveCount(3)

  // Clicking the leading checkbox completes the task.
  await firstTask.locator('.todo-check-btn').click()

  await expect(todos.locator('.todo-row')).toHaveCount(2)
  await expect(
    page.locator('.toast', { hasText: 'Marked "Renew car insurance" done.' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: /Hi Allister/ })).toContainText('2 to-dos')
  expect(completions).toEqual([{ id: 'stub-task-1', action: 'complete' }])
})

test('AI Today reschedules a to-do through its day menu', async ({ page }) => {
  const posts = []
  await page.route(`${TASKS_API_URL}/tasks`, async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON())
      await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
      return
    }
    await route.fallback()
  })

  await page.goto('/')
  const todos = page.getByTestId('task-rows')
  // The last row is the worst case: its menu opens past the bottom of both the
  // row and the card, so an ancestor that clips leaves nothing to click.
  const lastTask = todos.locator('.todo-row').last()
  await expect(lastTask.locator('strong')).toHaveText('Confirm the revised floor plan')
  await lastTask.getByRole('button', { name: /Reschedule/ }).click()

  // Hit-test where the menu actually paints. An ancestor with overflow:hidden
  // leaves the menu in the DOM and visible to a selector while clipping it out
  // of the page, and Playwright's own click would scroll that hidden overflow
  // into view rather than fail — only elementFromPoint sees the difference.
  const tomorrowItem = lastTask.getByRole('menuitem', { name: /Tomorrow/ })
  await expect(tomorrowItem).toBeVisible()
  const clickable = await tomorrowItem.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return el.contains(
      document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
    )
  })
  expect(clickable).toBe(true)

  await tomorrowItem.click()

  await expect(todos.locator('.todo-row')).toHaveCount(2)
  await expect(
    page.locator('.toast', { hasText: 'Moved "Confirm the revised floor plan" to tomorrow.' }),
  ).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(posts[0]).toMatchObject({ id: 'stub-email-task-1', action: 'reschedule' })
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  expect(posts[0].due_date).toBe(expected)
})

test('Profile dropdown contains Settings and Log out, and opens the settings page', async ({
  page,
}) => {
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto('/')

  const sidebarTextStyle = async (locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        borderRadius: style.borderRadius,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        gap: style.gap,
        height: style.height,
        padding: style.padding,
      }
    })
  const mailNavStyle = await sidebarTextStyle(page.locator('.sidebar-nav .nav-item').first())
  const mailLabelStyle = await sidebarTextStyle(page.locator('.sb-section-label').first())

  // Settings cog is no longer in the header
  await expect(page.locator('.header-right .icon-btn[title="Settings"]')).toHaveCount(0)

  // Clicking the avatar opens the dropdown
  await page.locator('.profile-container').click()
  const settingsItem = page.locator('.dropdown-menu-btn', { hasText: 'Settings' })
  const logoutItem = page.locator('.logout-btn', { hasText: 'Log out' })
  await expect(settingsItem).toBeVisible()
  await expect(logoutItem).toBeVisible()

  // Settings item opens the full settings page and closes the dropdown.
  await settingsItem.click()
  await expect(page).toHaveURL(/\/settings\/account$/)
  await expect(page.locator('.settings-page')).toBeVisible()
  await expect(page.locator('.profile-dropdown')).toHaveCount(0)
  await expect(page.locator('.settings-page')).toContainText('Notifications')
  await expect(page.locator('.settings-nav-label')).toHaveText([
    'General',
    'Email',
    'Calendar',
    'Documents',
  ])
  expect(await sidebarTextStyle(page.locator('.settings-nav-item').first())).toEqual(mailNavStyle)
  expect(await sidebarTextStyle(page.locator('.settings-nav-label').first())).toEqual(
    mailLabelStyle,
  )

  // Log out must not throw (regression: window is not accessible in template scope)
  await page.locator('.settings-back-link').click()
  await page.locator('.profile-container').click()
  await page.locator('.logout-btn').click()
  expect(pageErrors).toEqual([])
})

test('A Settings snippet is available as a slash command in the composer', async ({ page }) => {
  await page.goto('/')
  await page.locator('.profile-container').click()
  await page.locator('.dropdown-menu-btn', { hasText: 'Settings' }).click()

  const modal = page.locator('.settings-page')
  await modal.locator('.settings-nav-item', { hasText: 'Snippets' }).click()
  await modal.locator('.snippet-editor-form > .label-input').fill('incident')
  await modal
    .locator('.snippet-editor .composer-editor')
    .fill('Hi,\nWe’re currently investigating the incident and will share an update shortly.')
  await modal.getByRole('button', { name: 'Add snippet' }).click()
  await expect(modal.locator('.snippet-trigger')).toHaveText('/incident')
  await modal.locator('.settings-back-link').click()

  await page.locator('.compose-btn').click()
  const composer = page.locator('#composerToast')
  const editor = composer.locator('.composer-editor')
  await editor.fill('/inci')
  await composer.locator('.composer-slash-menu .suggestion-item', { hasText: 'incident' }).click()

  await expect(editor).toContainText('We’re currently investigating the incident')
  await expect(editor).not.toContainText('/inci')
})

test('Browser notifications can be enabled from Notifications settings', async ({ page }) => {
  // Headless engines deny OS notifications, so provide the same permission
  // surface while driving the real settings UI in every browser project.
  await page.addInitScript(() => {
    class TestNotification {
      static permission = 'default'

      static async requestPermission() {
        TestNotification.permission = 'granted'
        return 'granted'
      }
    }
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: TestNotification,
    })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Hi Allister/ })).toBeVisible()
  await page.locator('.profile-container').click()
  await page.locator('.dropdown-menu-btn', { hasText: 'Settings' }).click()

  const modal = page.locator('.settings-page')
  await modal.locator('.settings-nav-item', { hasText: 'Notifications' }).click()
  const browserNotifications = modal.locator('.browser-notifications-switch')
  await expect(browserNotifications).toBeEnabled()
  await browserNotifications.check()

  await expect(browserNotifications).toBeChecked()
  await expect(modal.locator('.browser-notifications-status')).toContainText('sender and subject')
  expect(await page.evaluate(() => Notification.permission)).toBe('granted')
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('cookie-browser-notifications:11111111-1111-4111-8111-111111111111'),
      ),
    ),
  ).toEqual({ enabled: true })
})

test('Composer disables Send while an email is being sent', async ({ page }) => {
  let releaseSend
  let sendRequests = 0
  let notifyRequestStarted
  const requestStarted = new Promise((resolve) => {
    notifyRequestStarted = resolve
  })
  await page.route('**/api/send', async (route) => {
    sendRequests += 1
    notifyRequestStarted()
    await new Promise((resolve) => {
      releaseSend = resolve
    })
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'sent-fixture' }),
    })
  })

  await page.goto('/')
  await page.locator('.compose-btn').click()

  const composer = page.locator('#composerToast')
  await composer.locator('.composer-to-inline').fill('person@example.com')
  await composer.locator('.composer-editor').fill('A message that should only send once.')
  const sendButton = composer.locator('.composer-footer .composer-send-btn')
  await sendButton.click()

  await requestStarted
  await expect(sendButton).toBeDisabled()
  await expect(sendButton).toHaveText('Sending…')
  expect(sendRequests).toBe(1)

  releaseSend()
  await expect(composer).not.toHaveClass(/active/)
  expect(sendRequests).toBe(1)
})

test('Composer "Send Later" queues a scheduled send instead of sending immediately', async ({
  page,
}) => {
  // Pairs a 'Next Week' reminder with a 'Tomorrow' send, so the two must fall
  // on different days — see freezeClockToMidweek.
  await freezeClockToMidweek(page)

  let sendRequestBody
  await page.route('**/api/send', async (route) => {
    sendRequestBody = route.request().postDataJSON()
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        scheduledSend: {
          id: 'sched-1',
          toAddresses: 'person@example.com',
          subject: '',
          scheduledFor: sendRequestBody.sendAt,
        },
      }),
    })
  })

  await page.goto('/')
  await page.locator('.compose-btn').click()

  const composer = page.locator('#composerToast')
  await composer.locator('.composer-to-inline').fill('person@example.com')
  await composer.locator('.composer-editor').fill('See you tomorrow.')

  await composer.locator('.composer-follow-up-btn').click()
  const followUpMenu = composer
    .locator('.composer-follow-up-btn')
    .locator('..')
    .locator('.ni-schedule-menu')
  await followUpMenu.getByRole('menuitem', { name: /Next Week/ }).click()

  await composer.locator('.composer-schedule-caret').click()
  const scheduleMenu = composer.locator('.ni-schedule-menu')
  await expect(scheduleMenu.getByRole('menuitem', { name: /Tomorrow/ })).toBeVisible()
  await scheduleMenu.getByRole('menuitem', { name: /Tomorrow/ }).click()

  await expect(page.locator('.toast', { hasText: 'Email scheduled for Tomorrow.' })).toBeVisible()
  await expect(composer).not.toHaveClass(/active/)
  expect(sendRequestBody).toMatchObject({
    to: 'person@example.com',
    text: 'See you tomorrow.',
    followUpAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  })
  expect(sendRequestBody.sendAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
})

test('A sent-message follow-up reminder persists across reload and can be cleared', async ({
  page,
}) => {
  await page.goto('/inbox?filter=sent')
  const firstRow = page.locator('.ni-row').first()
  await firstRow.click()

  const reader = page.locator('.ni-reader')
  await reader.getByTitle('Remind me if no reply').click()
  await reader.getByRole('menuitem', { name: /Tomorrow/ }).click()
  await expect(reader.locator('[title^="Follow-up reminder:"]')).toBeVisible()

  await page.reload()
  await page.locator('.ni-row').first().click()
  await expect(page.locator('.ni-reader [title^="Follow-up reminder:"]')).toBeVisible()

  await page.locator('.ni-reader [title^="Follow-up reminder:"]').click()
  await page.getByRole('menuitem', { name: 'Clear reminder' }).click()
  await expect(page.locator('.ni-reader [title="Remind me if no reply"]')).toBeVisible()
})

test('Clicking an inbox email slides in the reading panel', async ({ page }) => {
  await page.goto('/inbox')

  await expect(page.locator('.ni-header')).toHaveCount(0)

  const cityRow = page.locator('.ni-row', { hasText: 'City Construction' })
  await expect(cityRow.locator('.ni-subject .ni-ai-generated-icon')).toHaveCount(0)
  await cityRow.click()
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()
  await expect(reader.locator('.ni-reader-subject')).toContainText('Revised Floor Plan')
  await expect(reader.locator('.ni-reader-subject .ni-ai-generated-icon')).toHaveCount(0)

  // Reader actions sit together in the top-right toolbar.
  const actions = reader.locator('.ni-reader-topbar .ni-reader-nav').last()
  await expect(actions.locator('[title="Star"]')).toBeVisible()
  await expect(actions.locator('[title="Done"]')).toBeVisible()
  await expect(actions.locator('[title="Reschedule"]')).toBeVisible()

  // The reader no longer has close/previous/next nav buttons
  await expect(reader.locator('.ni-reader-close')).toHaveCount(0)
  await expect(reader.locator('[title="Previous"]')).toHaveCount(0)
  await expect(reader.locator('[title="Next"]')).toHaveCount(0)

  // Escape slides the panel away
  await page.keyboard.press('Escape')
  await expect(page.locator('.ni-reader')).toHaveCount(0)

  // Clicking outside the panel also closes it
  await cityRow.click()
  await expect(page.locator('.ni-reader')).toBeVisible()
  await page.locator('.ni-tabs').click({ position: { x: 2, y: 2 } })
  await expect(page.locator('.ni-reader')).toHaveCount(0)
})

test('Reader offers to add a detected email event to Calendar with details prefilled', async ({
  page,
}) => {
  // The fixture's tour date is computed (always in the future — the reader
  // suppresses past events), so the expectations derive from the same date.
  const { fixtureTourDate, fixtureTourDateText } = await import('../api/_fixtures/emails.js')
  const tourDate = fixtureTourDate()
  const tourDateText = fixtureTourDateText()
  const pad2 = (n) => String(n).padStart(2, '0')
  const tourDateValue = `${tourDate.getFullYear()}-${pad2(tourDate.getMonth() + 1)}-${pad2(tourDate.getDate())}`
  const weekday = tourDate.toLocaleDateString('en-GB', { weekday: 'short' })
  // Node abbreviates September as "Sept", browsers as "Sep" — compare on the
  // three-letter prefix both agree on.
  const monthShort = tourDate.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)

  await page.goto('/inbox')

  await page.locator('.ni-group-header', { hasText: 'Yesterday' }).click()
  await page.locator('.ni-row', { hasText: `Confirmation: ${tourDateText} guided tour` }).click()

  const suggestion = page.getByRole('region', { name: 'Calendar suggestion' })
  await expect(suggestion).toContainText('Event detected')
  await expect(suggestion).toContainText(
    new RegExp(`${weekday},? ${tourDate.getDate()} ${monthShort}`),
  )
  await expect(suggestion).toContainText('10:00')
  await suggestion.getByRole('button', { name: 'Add to calendar' }).click()

  await expect(page).toHaveURL(/\/calendar$/)
  const dialog = page.getByRole('dialog', { name: 'New event' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Event title' })).toHaveValue(
    `${tourDateText} guided tour`,
  )
  await expect(dialog.locator('input[type="date"]')).toHaveValue(tourDateValue)
  await expect(dialog.locator('input[type="time"]').nth(0)).toHaveValue('10:00')
  await expect(dialog.locator('input[type="time"]').nth(1)).toHaveValue('11:00')
  await expect(dialog.getByRole('textbox', { name: 'Event description' })).toHaveValue(
    /Univ of State Tours/,
  )
})

test("Pressing 'd' after opening an email link marks it Done", async ({ page }) => {
  await page.goto('/inbox')

  const subject = 'Revised Floor Plan - Natural Light adjustments'
  const row = page.locator('.ni-row', { hasText: subject })
  await row.click()
  const reader = page.locator('.ni-reader')
  await expect(reader.locator('.ni-reader-subject-text')).toHaveText(subject)

  const emailLink = reader
    .frameLocator('iframe[title="Email content"]')
    .getByRole('link', { name: 'View the full plan' })
  // Keep this test in the inbox tab while still exercising a real link click;
  // external navigation itself is unrelated to the focus-boundary regression.
  await emailLink.evaluate((link) =>
    link.addEventListener('click', (event) => event.preventDefault(), { once: true }),
  )
  await emailLink.click()
  // A prevented cross-frame navigation can leave Chromium focus on the top-level
  // body under parallel load. Put focus on the link explicitly so this test
  // exercises the iframe-to-document shortcut boundary deterministically.
  await emailLink.focus()
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => {
        if (
          !candidate.url().includes(MESSAGES_API_URL) ||
          candidate.request().method() !== 'PATCH'
        ) {
          return false
        }
        const body = candidate.request().postDataJSON()
        return body.id === 'fixture-1' && body.is_archived === true
      },
      { timeout: 5000 },
    ),
    page.keyboard.press('d'),
  ])

  expect(response.ok()).toBe(true)
  await expect(row).toHaveCount(0)
  // The Important tab is showing, so Done advances to the next important email.
  await expect(reader.locator('.ni-reader-subject')).toContainText('guided tour')

  await page.goto('/inbox?filter=done')
  await expect(page.locator('.ni-row', { hasText: subject })).toBeVisible()
})

test('Reader automatically shows a loading indicator and renders a one-line thread summary', async ({
  page,
}) => {
  let releaseSummary
  let requestBody
  let summaryRequestCount = 0
  let notifyRequestStarted
  const requestStarted = new Promise((resolve) => {
    notifyRequestStarted = resolve
  })
  const summaryHeld = new Promise((resolve) => {
    releaseSummary = resolve
  })
  await page.route(`${AI_API_URL}/summarize`, async (route) => {
    summaryRequestCount += 1
    requestBody = route.request().postDataJSON()
    notifyRequestStarted()
    await summaryHeld
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        summary: 'City Construction shared a revised plan and needs approval for the dimensions.',
        threadId: 'fixture-thread-1',
        latestMessageId: 'fixture-1',
      }),
    })
  })

  await page.goto('/inbox')
  const cityRow = page.locator('.ni-row', { hasText: 'City Construction' })
  await expect(cityRow.locator('.ni-ai-generated-icon')).toHaveCount(0)
  await cityRow.click()
  const reader = page.locator('.ni-reader')
  await requestStarted

  expect(summaryRequestCount).toBe(1)
  expect(requestBody).toEqual({ id: 'fixture-1' })
  const summary = reader.locator('.ni-reader-subject + .ni-thread-summary')
  await expect(summary).toContainText('Summarizing thread…')
  await expect(summary.locator('.ni-summary-spinner')).toBeVisible()
  await expect(reader.locator('.ni-summarize-btn')).toHaveCount(0)

  releaseSummary()
  await expect(summary).toBeVisible()
  await expect(summary).toContainText(
    'City Construction shared a revised plan and needs approval for the dimensions.',
  )
  await expect(summary.locator('.ni-thread-summary-text')).toHaveCSS('white-space', 'nowrap')
  await expect(reader.locator('.ni-reader-subject .ni-ai-generated-icon')).toHaveText(
    'auto_awesome',
  )

  await page.keyboard.press('Escape')
  await expect(cityRow.locator('.ni-subject .ni-ai-generated-icon')).toHaveText('auto_awesome')
})

test('Reader restores a fresh saved thread summary without regenerating it', async ({ page }) => {
  await page.goto('/inbox')
  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  await row.click()

  let reader = page.locator('.ni-reader')
  await expect(reader.locator('.ni-thread-summary')).toContainText(
    'City Construction shared a revised kitchen plan',
  )

  await page.reload()
  await expect(row.locator('.ni-subject .ni-ai-generated-icon')).toHaveText('auto_awesome')
  await row.click()
  reader = page.locator('.ni-reader')

  await expect(reader.locator('.ni-thread-summary')).toContainText(
    'City Construction shared a revised kitchen plan',
  )
  await expect(reader.locator('.ni-summarize-btn')).toHaveCount(0)
})

test('Reader shows the whole conversation with the earlier message collapsed', async ({ page }) => {
  await page.goto('/inbox')
  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  await row.click()

  const reader = page.locator('.ni-reader')
  await expect(reader.locator('.ni-thread-toolbar')).toContainText('2 messages')
  const conversation = reader.locator('.ni-conversation')
  const cards = conversation.locator('> *')
  await expect(cards).toHaveCount(2)

  // Oldest first: the collapsed check-in, then the open design update.
  const earlier = cards.nth(0)
  await expect(earlier).toHaveClass(/ni-thread-message/)
  await expect(earlier).toContainText('City Construction')
  await expect(earlier).toContainText(
    'Quick check-in before we finalize the kitchen floor plan design.',
  )
  await expect(earlier).not.toContainText('window placement')
  await expect(cards.nth(1)).toHaveClass(/ni-email-card/)

  await earlier.click()
  const opened = conversation.locator('.ni-thread-message-open')
  await expect(opened).toContainText('any thoughts on the window placement we discussed')
  await expect(reader.locator('.ni-thread-toggle-all')).toHaveText('Collapse all')

  await opened.getByRole('button', { name: 'Collapse message' }).click()
  await expect(conversation.locator('.ni-thread-message-open')).toHaveCount(0)
  await expect(cards.nth(0)).toHaveClass(/ni-thread-message/)

  await reader.locator('.ni-thread-toggle-all').click()
  await expect(conversation.locator('.ni-thread-message-open')).toHaveCount(1)
  await reader.locator('.ni-thread-toggle-all').click()
  await expect(conversation.locator('.ni-thread-message-open')).toHaveCount(0)
})

test('Attachments show in the reader and download when clicked', async ({ page }) => {
  await page.goto('/inbox')
  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  await expect(row.locator('.ni-row-attachment-icon')).toBeVisible()

  await row.click()
  const reader = page.locator('.ni-reader')
  const attachment = reader.locator('.ni-attachment')
  await expect(attachment).toHaveCount(1)
  await expect(attachment).toContainText('Revised-Floor-Plan.pdf')
  await expect(attachment).toContainText('2.3 MB')
  await expect(attachment).toHaveAttribute('title', 'Download Revised-Floor-Plan.pdf')

  const [download] = await Promise.all([page.waitForEvent('download'), attachment.click()])
  expect(download.suggestedFilename()).toBe('Revised-Floor-Plan.pdf')
})

test('Reader scheduling offers Tomorrow and Next Week, then removes the email until it is due', async ({
  page,
}) => {
  // Asserts both options are present, and near the weekend one of them is
  // dropped for naming the same day as the other — see freezeClockToMidweek.
  await freezeClockToMidweek(page)
  await page.goto('/inbox')

  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  await row.click()
  const reader = page.locator('.ni-reader')

  await reader.locator('[title="Reschedule"]').click()
  const scheduleMenu = reader.locator('.ni-schedule-menu')
  await expect(scheduleMenu.getByRole('menuitem', { name: /Tomorrow/ })).toBeVisible()
  await expect(scheduleMenu.getByRole('menuitem', { name: /Next Week/ })).toBeVisible()
  await scheduleMenu.getByRole('menuitem', { name: /Tomorrow/ }).click()
  await expect(page.locator('.toast', { hasText: 'Scheduled for Tomorrow.' })).toBeVisible()
  await expect(row).toHaveCount(0)
  // Scheduling follows the same triage flow as Done: the next email in the
  // Important tab opens.
  await expect(reader.locator('.ni-reader-subject')).toContainText('guided tour')

  const tourRow = page.locator('.ni-row', { hasText: 'guided tour' })
  await reader.locator('[title="Star"]').click()
  await expect(reader).toHaveCount(0)
  await expect(tourRow).toHaveCount(0)

  await page.locator('.nav-item', { hasText: 'Starred' }).click()
  await expect(page).toHaveURL(/filter=starred/)
  await expect(page.locator('.ni-row', { hasText: 'guided tour' })).toBeVisible()
})

test('A due scheduled email appears at the top in the conditional Due Today group', async ({
  page,
}) => {
  await page.route(`${EMAILS_API_URL}/emails?limit=50`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        emails: [
          {
            id: 'due-fixture',
            from_name: 'Reminder Service',
            from_address: 'reminders@example.com',
            subject: 'Scheduled follow-up',
            snippet: 'This message is due now.',
            body_text: 'This message is due now.',
            sent_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            scheduled_for: new Date(Date.now() - 60 * 1000).toISOString(),
            is_unread: true,
            is_starred: false,
            is_sent: false,
            has_html: false,
            labels: [],
          },
        ],
        nextCursor: null,
        unreadCount: 1,
      }),
    })
  })

  await page.goto('/inbox')

  const headers = page.locator('.ni-group-header')
  await expect(headers).toHaveCount(1)
  await expect(headers.first()).toContainText('Due Today')
  await expect(page.locator('.ni-row', { hasText: 'Scheduled follow-up' })).toBeVisible()
})

test('Snoozed groups emails by their snooze target with both groups expanded', async ({ page }) => {
  const now = new Date(2026, 6, 14, 12)
  await page.clock.setFixedTime(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7))
  nextWeek.setHours(8, 0, 0, 0)

  await page.route(`${EMAILS_API_URL}/emails?folder=snoozed&limit=50`, async (route) => {
    const email = (id, subject, sentAt, scheduledFor) => ({
      id,
      from_name: 'Reminder Service',
      from_address: 'reminders@example.com',
      subject,
      snippet: subject,
      body_text: subject,
      sent_at: sentAt,
      scheduled_for: scheduledFor,
      is_unread: false,
      is_starred: false,
      is_sent: false,
      has_html: false,
      labels: [],
    })
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        emails: [
          email(
            '10000000-0000-4000-8000-000000000002',
            'Next-week reminder',
            now.toISOString(),
            nextWeek.toISOString(),
          ),
          email(
            '10000000-0000-4000-8000-000000000001',
            'Tomorrow reminder',
            new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
            tomorrow.toISOString(),
          ),
        ],
        nextCursor: null,
        unreadCount: 0,
      }),
    })
  })

  await page.goto('/inbox?filter=snoozed')

  const headers = page.locator('.ni-group-header')
  await expect(headers).toHaveCount(2)
  await expect(headers.nth(0)).toContainText('Tomorrow')
  await expect(headers.nth(1)).toContainText('Next Week')
  await expect(headers.nth(0)).toHaveAttribute('aria-expanded', 'true')
  await expect(headers.nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.ni-row', { hasText: 'Tomorrow reminder' })).toBeVisible()
  await expect(page.locator('.ni-row', { hasText: 'Next-week reminder' })).toBeVisible()
})

test('Reply slides an inline reply box under the email instead of opening the composer', async ({
  page,
}) => {
  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()

  const reader = page.locator('.ni-reader')
  await reader.locator('.ni-reader-footer .ni-pill-btn', { hasText: 'Reply' }).click()

  const replyBox = reader.locator('.ni-reply-box')
  await expect(replyBox).toBeVisible()
  // The old composer toast must NOT open
  await expect(page.locator('#composerToast.active')).toHaveCount(0)

  // Send is disabled until text is entered
  await expect(replyBox.locator('.btn-primary')).toBeDisabled()
  const replyEditor = replyBox.locator('.composer-editor')
  await replyEditor.click()
  await replyEditor.pressSequentially('Thanks, the revised plan looks great.')

  // The reply body is the same rich editor as compose: "/" offers commands.
  await replyEditor.pressSequentially('/div')
  const slashMenu = replyBox.locator('.composer-slash-menu')
  await expect(slashMenu).toBeVisible()
  await slashMenu.locator('.suggestion-item', { hasText: 'Divider' }).click()
  await expect(replyEditor.locator('hr')).toBeVisible()
  await expect(replyEditor).not.toContainText('/div')

  await replyBox.locator('.btn-primary').click()

  await expect(reader.locator('.ni-reply-box')).toHaveCount(0)
  await expect(page.locator('.toast', { hasText: 'Reply sent.' })).toBeVisible()
})

for (const width of [1280, 390]) {
  test(`Reply AI button generates inline, saves, and waits for Send at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    let releaseGeneration
    const generation = new Promise((resolve) => {
      releaseGeneration = resolve
    })
    let aiRequest
    const saved = []
    let sends = 0
    await page.route(`${AI_API_URL}/compose`, async (route) => {
      aiRequest = route.request().postDataJSON()
      await generation
      await route.fulfill({
        json: { draft: { text: 'Could you confirm the updated dimensions and price?' } },
      })
    })
    await page.route(`${DRAFTS_API_URL}/drafts**`, async (route) => {
      if (['POST', 'PATCH'].includes(route.request().method()))
        saved.push(route.request().postDataJSON())
      await route.fallback()
    })
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/send') sends++
    })
    await page.goto('/inbox?open=fixture-1')
    await page.locator('.ni-email-card [title="Reply"]').click()
    const reply = page.locator('.ni-reply-box')
    const editor = reply.locator('.composer-editor')
    await editor.fill('Ask about the dimensions and price.')
    await reply.getByRole('button', { name: 'AI', exact: true }).click()
    await expect(reply.getByRole('button', { name: 'Generating…' })).toBeDisabled()
    await expect(reply.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await editor.focus()
    releaseGeneration()
    await expect(editor).toHaveText('Could you confirm the updated dimensions and price?')
    expect(aiRequest).toMatchObject({
      replyToMessageId: 'fixture-1',
      existingText: 'Ask about the dimensions and price.',
    })
    await expect
      .poll(() => saved.some((draft) => draft.text.includes('updated dimensions and price')))
      .toBe(true)
    expect(sends).toBe(0)
    await expect(reply.getByRole('button', { name: 'AI', exact: true })).toBeEnabled()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await editor.fill('My reviewed reply: could you confirm the price?')
    await reply.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.locator('.toast', { hasText: 'Reply sent.' })).toBeVisible()
    expect(sends).toBe(1)
  })
}

test('Important reply draft is ready beneath the email, keeps edits on reload, and sends only on click', async ({
  page,
}) => {
  let draft = {
    id: 'auto-priority-draft',
    replyToMessageId: 'fixture-1',
    isAiGenerated: true,
    to: 'updates@cityconstruction.com',
    subject: 'Re: Revised Floor Plan - Natural Light adjustments',
    text: 'Thanks for the updated plan. Could you confirm the proposed window dimensions?',
    html: null,
    attachments: [],
    followUpAt: null,
    updatedAt: new Date().toISOString(),
  }
  await page.route(`${DRAFTS_API_URL}/drafts**`, async (route) => {
    const request = route.request()
    if (request.method() === 'DELETE') {
      draft = null
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'PATCH') {
      draft = { ...draft, ...request.postDataJSON() }
      return route.fulfill({ json: { draft: { id: draft.id, updatedAt: draft.updatedAt } } })
    }
    return route.fulfill({ json: { drafts: draft ? [draft] : [] } })
  })
  let sends = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/send') sends++
  })
  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  const reply = page.locator('.ni-reply-box')
  await expect(reply).toContainText('AI draft')
  await expect(reply.locator('.composer-editor')).toContainText(
    'Could you confirm the proposed window dimensions?',
  )
  await expect(reply.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  expect(sends).toBe(0)
  await reply
    .locator('.composer-editor')
    .fill('Thanks. Could you confirm the dimensions and estimated cost?')
  await expect.poll(() => draft.text).toContain('dimensions and estimated cost')
  await page.reload()
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(reply.locator('.composer-editor')).toContainText('dimensions and estimated cost')
  expect(sends).toBe(0)
  await reply.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'Reply sent.' })).toBeVisible()
  await expect(reply).toHaveCount(0)
  await expect.poll(() => draft).toBe(null)
  expect(sends).toBe(1)
})

test('Forward opens a quoted draft with the original attachment', async ({ page }) => {
  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()

  const reader = page.locator('.ni-reader')
  await reader.locator('.ni-reader-footer .ni-pill-btn', { hasText: 'Forward' }).click()

  const composer = page.locator('#composerToast')
  await expect(composer).toHaveClass(/active/)
  await expect(composer.locator('.composer-to-inline')).toHaveValue('')
  await expect(composer.locator('.composer-subject-inline')).toHaveValue(
    'Fwd: Revised Floor Plan - Natural Light adjustments',
  )
  await expect(composer.locator('.composer-editor')).toContainText('Forwarded message')
  await expect(composer.locator('.composer-editor')).toContainText(
    'Hi Allister, here is the updated design',
  )

  const attachment = composer.locator('.composer-attachment-chip')
  await expect(attachment).toContainText('Revised-Floor-Plan.pdf')
  await attachment.getByRole('button', { name: 'Remove Revised-Floor-Plan.pdf' }).click()
  await expect(composer.locator('.composer-attachment-chip')).toHaveCount(0)
})

test('Header search uses hybrid mode for both debounced typing and Enter', async ({ page }) => {
  await page.goto('/')

  const searchInput = page.locator('.search-input')
  await searchInput.fill('zoom')
  await expect(page).toHaveURL(/\/search\?/)
  await expect(page.locator('.search-results-item')).toHaveCount(1)
  await expect(page.locator('.ni-row').first()).toContainText('Zoom Video')
  let params = new URL(page.url()).searchParams
  expect(params.get('q')).toBe('zoom')
  expect(params.get('mode')).toBeNull()

  // Enter re-navigates immediately using the same ranking mode.
  await searchInput.fill('city')
  await searchInput.press('Enter')
  await expect(page.locator('.ni-row').first()).toContainText('City Construction')
  params = new URL(page.url()).searchParams
  expect(params.get('q')).toBe('city')
  expect(params.get('mode')).toBeNull()
})

test('/search renders mixed mail and document results from a direct URL', async ({ page }) => {
  await page.goto('/search?q=floor+plan')

  await expect(page.locator('.search-results-tab.active')).toHaveText('All')
  const items = page.locator('.search-results-item')
  await expect(items).not.toHaveCount(0)
  await expect(page.locator('.ni-row', { hasText: 'Revised Floor Plan' })).toBeVisible()
  await expect(page.locator('.search-result-doc', { hasText: 'Floor plan notes' })).toBeVisible()
})

test('Clicking a mail result in search results opens it in the reader', async ({ page }) => {
  await page.goto('/search?q=floor+plan')

  await page.locator('.ni-row', { hasText: 'Revised Floor Plan' }).click()

  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('.ni-reader-subject-text')).toHaveText(
    'Revised Floor Plan - Natural Light adjustments',
  )
})

test('Clicking a document result in search results opens the document', async ({ page }) => {
  await page.goto('/search?q=floor+plan')

  await page.locator('.search-result-doc', { hasText: 'Floor plan notes' }).click()

  await expect(page).toHaveURL(/\/documents\/stub-doc-floor-plan$/)
})

test('Search: task names, descriptions and sub-task titles match, and open the panel', async ({
  page,
}) => {
  // A task with a description and a sub-task, so all three searchable fields
  // exist on one row.
  await page.goto('/tasks?project=inbox')
  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Repaint the hallway')
  await page.locator('.add-task-row input').press('Enter')
  await page.locator('.task-open').click()
  await expect(page.locator('.task-panel')).toBeVisible()

  await page.locator('.task-panel-description').click()
  await page.locator('.task-panel-description-input').fill('Pick an eggshell finish')
  await page.locator('.task-panel-description-input').blur()

  await page.locator('.add-subtask-btn').click()
  await page.locator('.add-subtask-row input').fill('Buy sandpaper')
  await page.locator('.add-subtask-row input').press('Enter')
  await expect(page.locator('.subtask-row')).toHaveCount(1)

  // Search task names from the main header, then narrow to the Tasks tab.
  await page.goto('/tasks?project=inbox')
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveCount(0)
  await page.locator('.search-input').fill('hallway')
  await page.locator('.search-input').press('Enter')
  await expect(
    page.locator('.search-result-task', { hasText: 'Repaint the hallway' }),
  ).toBeVisible()
  await page.locator('.search-results-tab', { hasText: 'Tasks' }).click()
  await expect(page.locator('.search-results-tab.active')).toHaveText('Tasks')
  await expect(
    page.locator('.search-result-task', { hasText: 'Repaint the hallway' }),
  ).toBeVisible()

  // A description match, this time under All — tasks join the combined list.
  await page.goto('/search?q=eggshell')
  await expect(
    page.locator('.search-result-task', { hasText: 'Repaint the hallway' }),
  ).toBeVisible()

  // A sub-task title match surfaces the parent task (the row a person can
  // open), and clicking it lands on the task's list with the panel open.
  await page.goto('/search?q=sandpaper&scope=tasks')
  await page.locator('.search-result-task', { hasText: 'Repaint the hallway' }).click()
  await expect(page).toHaveURL(/\/tasks\?.*task=/)
  await expect(page.locator('.task-panel-title')).toHaveText('Repaint the hallway')
})

test('Search scope tabs re-fetch, and a mail-only operator returns nothing under Docs', async ({
  page,
}) => {
  await page.goto('/search?q=sender%3Abilling%40zoom.us')

  await expect(page.locator('.search-results-item')).toHaveCount(1)
  await expect(page.locator('.ni-row').first()).toContainText('Zoom Video')
  await expect(page.locator('.search-result-doc')).toHaveCount(0)

  // sender: is mail-only: under the Docs tab it matches nothing at all,
  // rather than falling back to an unfiltered document list.
  await page.locator('.search-results-tab', { hasText: 'Docs' }).click()
  await expect(page).toHaveURL(/scope=documents/)
  await expect(page.locator('.search-results-empty')).toContainText('No results')

  await page.locator('.search-results-tab', { hasText: 'Mail' }).click()
  await expect(page).toHaveURL(/scope=mail/)
  await expect(page.locator('.ni-row').first()).toContainText('Zoom Video')
})

test('in:done reaches archived mail the default search hides, without pulling in documents', async ({
  page,
}) => {
  await page.goto('/inbox')

  const subject = 'Revised Floor Plan - Natural Light adjustments'
  const row = page.locator('.ni-row', { hasText: subject })
  await row.hover()
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(MESSAGES_API_URL) && response.request().method() === 'PATCH',
    ),
    row.locator('[title="Done"]').click(),
  ])

  // Search skips Done mail unless in: asks for it — the operator the search
  // placeholder advertises. The document with the same words in its title is
  // unaffected by mail's archived state either way.
  const searchInput = page.locator('.search-input')
  await searchInput.fill('floor plan')
  await expect(page).toHaveURL(/\/search\?/)
  await expect(page.locator('.ni-row')).toHaveCount(0)
  await expect(page.locator('.search-result-doc', { hasText: 'Floor plan notes' })).toBeVisible()

  // in: is mail-only, so it also excludes the document from this result set.
  await searchInput.fill('in:done floor plan')
  await expect(page.locator('.ni-row')).toHaveCount(1)
  await expect(page.locator('.ni-row').first()).toContainText('City Construction')
  await expect(page.locator('.search-result-doc')).toHaveCount(0)
})

test('tag: filters mail and documents independently, by their own tag/label field', async ({
  page,
}) => {
  await page.goto('/search?q=tag%3AFinance')

  await expect(page.locator('.ni-row')).toHaveCount(3)
  await expect(page.locator('.ni-row', { hasText: 'Zoom Video' })).toBeVisible()
  await expect(page.locator('.search-result-doc')).toHaveCount(0)

  await page.locator('.search-input').fill('tag:notes')
  await expect(page.locator('.ni-row')).toHaveCount(0)
  await expect(page.locator('.search-result-doc')).toHaveCount(1)
  await expect(page.locator('.search-result-doc')).toContainText('Scratchpad')
})

test('The clear icon empties the header search box, and leaving /search clears it too', async ({
  page,
}) => {
  await page.goto('/search?q=zoom')

  const searchInput = page.locator('.search-input')
  await expect(searchInput).toHaveValue('zoom')

  await page.locator('.search-clear-icon').click()
  await expect(searchInput).toHaveValue('')

  await searchInput.fill('zoom')
  await expect(page).toHaveURL(/\/search\?/)
  await page.locator('.nav-item', { hasText: 'Inbox' }).click()

  await expect(page).toHaveURL(/\/inbox$/)
  await expect(searchInput).toHaveValue('')
})

test('Ask the assistant about a search query answers with formatted text and email sources', async ({
  page,
}) => {
  await page.goto('/search?q=Summarize%20my%20kitchen%20renovation%20updates.')

  await page.locator('.search-results-ask', { hasText: 'kitchen renovation' }).click()

  const drawer = page.locator('#geminiChatDrawer')
  await expect(drawer).toHaveClass(/active/)

  const aiMessage = drawer.locator('.chat-msg.ai').last()
  await expect(aiMessage).toContainText('City Construction')
  // Markdown is rendered, not shown raw
  await expect(aiMessage).not.toContainText('**')
  // The answer cites the email it came from
  await expect(aiMessage.locator('.chat-source')).toContainText('Revised Floor Plan')
})

test('Star rollback: a failed persistence reverts the star and shows an error', async ({
  page,
}) => {
  // Force the persistence call to fail; the optimistic star must roll back.
  await page.route(`${MESSAGES_API_URL}/messages`, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  )
  await page.goto('/inbox')

  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  const starBtn = row.locator('[title="Star"]')
  const rowBoxBeforeHover = await row.boundingBox()
  await row.hover()

  const [rowBox, actionsBox] = await Promise.all([
    row.boundingBox(),
    row.locator('.ni-actions').boundingBox(),
  ])
  // The action toolbar is absolutely positioned over the row precisely so that
  // revealing it on hover (its buttons are taller than the .ni-date it covers)
  // does not stretch the row's height.
  expect(rowBox.height).toBe(rowBoxBeforeHover.height)
  // It should be vertically centred within the row, not just clipped to it.
  const rowMidY = rowBox.y + rowBox.height / 2
  const actionsMidY = actionsBox.y + actionsBox.height / 2
  expect(Math.abs(actionsMidY - rowMidY)).toBeLessThanOrEqual(1)
  expect(rowBox.x + rowBox.width - (actionsBox.x + actionsBox.width)).toBeGreaterThanOrEqual(16)

  await starBtn.click()

  await expect(page.locator('.toast', { hasText: 'Failed to update starred state.' })).toBeVisible()
  await expect(starBtn).not.toHaveClass(/starred/)
})

test('Settings Labels pane lists, creates and renames labels', async ({ page }) => {
  const labelName = 'Receipts'
  await page.goto('/')

  // Open settings via the profile dropdown
  await page.locator('.profile-container').click()
  await page.locator('.dropdown-menu-btn', { hasText: 'Settings' }).click()
  const modal = page.locator('.settings-page')
  await expect(modal).toBeVisible()

  // Switch to the Labels category
  await modal.locator('.settings-nav-item', { hasText: 'Labels' }).click()
  await expect(modal.locator('.label-table-row')).not.toHaveCount(0)
  await expect(modal.locator('.ni-label-pill', { hasText: 'Finance' })).toBeVisible()

  // Create a label
  await modal.locator('.label-input').first().fill(labelName)
  await modal.locator('.label-create-form .btn-primary').click()
  await expect(modal.locator('.ni-label-pill', { hasText: labelName }).first()).toBeVisible()

  // Rename the new label inline.
  const renamedLabel = 'Invoices'
  await modal.getByTitle(`Rename ${labelName}`).click()
  const renameInput = modal.getByLabel(`Rename ${labelName}`)
  await renameInput.fill(renamedLabel)
  await renameInput.press('Enter')
  await expect(modal.locator('.ni-label-pill', { hasText: renamedLabel })).toBeVisible()
  await expect(modal.locator('.ni-label-pill', { hasText: labelName })).toHaveCount(0)
})

test('Settings Categories pane lists, creates and edits categories', async ({ page }) => {
  await page.goto('/settings/categories')
  const settings = page.locator('.settings-page')
  await expect(settings.locator('.ni-category-pill', { hasText: 'Projects' })).toBeVisible()

  await settings.locator('input[placeholder="Category name"]').fill('Clients')
  await settings.locator('.category-settings .btn-primary').click()
  await expect(settings.locator('.ni-category-pill', { hasText: 'Clients' })).toBeVisible()

  await settings.getByTitle('Edit Clients').click()
  const name = settings.getByLabel('Edit name for Clients')
  const description = settings.getByLabel('Edit description for Clients')
  await name.fill('Customers')
  await description.fill('People we work with')
  await description.press('Enter')
  await expect(settings.locator('.ni-category-pill', { hasText: 'Customers' })).toBeVisible()
  await expect(
    settings.locator('.label-description', { hasText: 'People we work with' }),
  ).toBeVisible()
})

test("Command palette opens with '/', filters and navigates to Starred", async ({ page }) => {
  await page.goto('/inbox')

  await page.keyboard.press('/')
  const panel = page.locator('.cp-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.cp-item').first()).toHaveClass(/selected/)

  await page.keyboard.type('go to starred')
  await page.keyboard.press('Enter')

  await expect(page.locator('.cp-panel')).toBeHidden()
  await expect(page).toHaveURL(/filter=starred/)
  await expect(page.locator('.ni-header h1')).toHaveText('Starred')
  // Only the two starred fixtures remain.
  await expect(page.locator('.ni-row')).toHaveCount(2)
  await expect(page.locator('.ni-row').first()).toContainText("Homeowner's Insurance")
})

test("The '/' command palette Create Event opens the dialog from any route", async ({ page }) => {
  await freezeCalendarClock(page)
  await page.goto('/inbox')
  await page.keyboard.press('/')
  const panel = page.locator('.cp-panel')
  await expect(panel).toBeVisible()
  const createEvent = panel.locator('.cp-item', { hasText: 'Create Event' })
  await expect(createEvent).toBeVisible()

  await createEvent.click()
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(/\/calendar$/)
  const dialog = page.getByRole('dialog', { name: 'New event' })
  await expect(dialog).toBeVisible()
  const aiInput = dialog.getByRole('textbox', { name: 'Describe your event' })
  await expect(aiInput).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'Advanced' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Advanced' }).click()
  await expect(dialog.locator('input[type="date"]')).toHaveValue('2026-07-24')
})

test('Command palette Mark Done archives the open email', async ({ page }) => {
  await page.goto('/inbox')

  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(page.locator('.ni-reader')).toBeVisible()

  await page.keyboard.press('/')
  const firstItem = page.locator('.cp-item').first()
  await expect(firstItem).toContainText('Mark Done')
  await expect(firstItem.locator('.cp-keycap')).toHaveText('D')
  await page.keyboard.press('Enter')

  await expect(page.locator('.cp-panel')).toBeHidden()
  await expect(page.locator('.ni-reader')).toHaveCount(0)
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toHaveCount(0)
  const toast = page.locator('.toast', { hasText: 'Marked done.' })
  await expect(toast).toBeVisible()

  await page.keyboard.press('u')
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toBeVisible()
})

test("Pressing 'u' cancels a queued send and restores its draft", async ({ page }) => {
  let sendRequests = 0
  await page.route('**/api/send', async (route) => {
    sendRequests += 1
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'sent' }) })
  })
  await page.goto('/')
  await page.locator('.compose-btn').click()

  const composer = page.locator('#composerToast')
  await composer.locator('.composer-to-inline').fill('person@example.com')
  await composer.locator('.composer-subject-inline').fill('Shortcut undo')
  await composer.locator('.composer-editor').fill('Keep this draft.')
  await composer.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.undo-send-toast')).toBeVisible()

  await page.keyboard.press('u')

  await expect(page.locator('.undo-send-toast')).toHaveCount(0)
  await expect(composer).toHaveClass(/active/)
  await expect(composer.locator('.composer-to-inline')).toHaveValue('person@example.com')
  await expect(composer.locator('.composer-subject-inline')).toHaveValue('Shortcut undo')
  await expect(composer.locator('.composer-editor')).toContainText('Keep this draft.')
  expect(sendRequests).toBe(0)
})

test('Drafts folder sits under Sent only while a draft exists', async ({ page }) => {
  await page.goto('/')
  const navItems = page.locator('.sidebar-nav .nav-item')
  await navItems.filter({ hasText: 'More' }).click()
  await expect(navItems.filter({ hasText: 'Sent' })).toBeVisible()
  // Nothing saved yet: no folder at all, not an empty one.
  const draftsItem = navItems.filter({ hasText: 'Drafts' })
  await expect(draftsItem).toHaveCount(0)

  await page.locator('.compose-btn').click()
  const composer = page.locator('#composerToast')
  await composer.locator('.composer-subject-inline').fill('Half-written')
  await composer.locator('.composer-editor').fill('Back to this later.')

  // Autosave lands after the typing pause and the folder follows it in,
  // directly beneath Sent.
  await expect(draftsItem).toBeVisible()
  await expect(draftsItem.locator('.nav-badge')).toHaveText('1')
  const labels = await page.locator('.sidebar-nav .nav-item .nav-text').allTextContents()
  expect(labels.indexOf('Drafts')).toBe(labels.indexOf('Sent') + 1)

  // Reloading proves the draft (and so the folder) came back from the server.
  await page.reload()
  await navItems.filter({ hasText: 'More' }).click()
  await expect(draftsItem).toBeVisible()

  await draftsItem.click()
  await expect(page.locator('.drafts-row', { hasText: 'Half-written' })).toBeVisible()
  await page.locator('.drafts-discard').click()
  await expect(page.locator('.drafts-row')).toHaveCount(0)
  await expect(draftsItem).toHaveCount(0)
})

test('Command palette Reply opens the inline reply box', async ({ page }) => {
  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()

  await page.keyboard.press('/')
  const panel = page.locator('.cp-panel')
  await expect(panel).toBeVisible()
  await page.keyboard.type('reply')
  await expect(panel.locator('.cp-item').first()).toContainText('Reply')
  await page.keyboard.press('Enter')

  await expect(panel).toBeHidden()
  await expect(reader.locator('.ni-reply-box')).toBeVisible()
})

test('Command palette Snooze until tomorrow schedules the open email', async ({ page }) => {
  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(page.locator('.ni-reader')).toBeVisible()

  await page.keyboard.press('/')
  await expect(page.locator('.cp-panel')).toBeVisible()
  await page.keyboard.type('snooze until tomorrow')
  await page.keyboard.press('Enter')

  await expect(page.locator('.cp-panel')).toBeHidden()
  await expect(page.locator('.toast', { hasText: 'Scheduled for Tomorrow.' })).toBeVisible()
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toHaveCount(0)
})

async function runPaletteCommand(page, text) {
  await page.keyboard.press('/')
  await expect(page.locator('.cp-panel')).toBeVisible()
  await page.keyboard.type(text)
  await expect(page.locator('.cp-item').first()).toContainText(text, { ignoreCase: true })
  await page.keyboard.press('Enter')
  await expect(page.locator('.cp-panel')).toBeHidden()
}

test('Command palette drives the calendar view, period and Today', async ({ page }) => {
  await freezeCalendarClock(page)
  await page.goto('/calendar')
  await expect(
    page.getByRole('heading', { name: 'Friday, July 24, 2026', exact: true }),
  ).toHaveCount(2)

  await runPaletteCommand(page, 'Calendar: Week view')
  await expect(page.getByRole('heading', { name: 'Jul 20 – 26, 2026' })).toBeVisible()

  await runPaletteCommand(page, 'Calendar: Next period')
  await expect(page.getByRole('heading', { name: 'Jul 27 – Aug 2, 2026' })).toBeVisible()

  await runPaletteCommand(page, 'Calendar: Go to Today')
  await expect(page.getByRole('heading', { name: 'Jul 20 – 26, 2026' })).toBeVisible()
})

test('Command palette New Project and Add Divider work on the Tasks app', async ({ page }) => {
  await page.goto('/tasks?project=inbox')
  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('First')
  await page.locator('.add-task-row input').press('Enter')
  await expect(page.locator('.task-content')).toHaveText(['First'])

  await runPaletteCommand(page, 'Add Divider')
  const rows = page.locator('.task-rows > .task-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toHaveClass(/task-divider/)

  await runPaletteCommand(page, 'New Project')
  const input = page.locator('.tasks-sidebar .new-project-row input')
  await expect(input).toBeFocused()
  await input.fill('Roof')
  await input.press('Enter')
  await expect(page.locator('.tasks-sidebar .project-item', { hasText: 'Roof' })).toBeVisible()
})

test('Command palette New Folder opens the folder row after switching to Documents', async ({
  page,
}) => {
  await page.goto('/inbox')

  await runPaletteCommand(page, 'New Folder')
  await expect(page).toHaveURL(/\/documents$/)
  const input = page.locator('.documents-sidebar').getByLabel('New folder name')
  await expect(input).toBeFocused()
  await input.fill('Reading list')
  await input.press('Enter')
  await expect(
    page.locator('.documents-sidebar .folder-item', { hasText: 'Reading list' }),
  ).toBeVisible()
})

test('Escape closes the palette but keeps the reading panel open', async ({ page }) => {
  await page.goto('/inbox')

  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(page.locator('.ni-reader')).toBeVisible()

  await page.keyboard.press('/')
  await expect(page.locator('.cp-panel')).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(page.locator('.cp-panel')).toBeHidden()
  await expect(page.locator('.ni-reader')).toBeVisible()
})

test('A top loading bar shows while the inbox is fetching and hides afterwards', async ({
  page,
}) => {
  // Hold the emails response so the initial load is observably in flight.
  await page.route(`${EMAILS_API_URL}/emails**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await route.fallback()
  })

  await page.goto('/inbox')

  const bar = page.locator('.loading-bar')
  await expect(bar).toBeVisible()

  // Once the data lands the bar goes away and the list is populated.
  await expect(bar).toHaveCount(0, { timeout: 10000 })
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toBeVisible()
})

test('Hovering the Today unread count reveals Mark Read, which clears the day', async ({
  page,
}) => {
  await page.goto('/inbox')

  // Today holds one unread inbox email (the other arrival is starred and
  // lives in the Starred view instead).
  const todayHeader = page.locator('.ni-group-header', { hasText: 'Today' })
  await expect(todayHeader.locator('.ni-group-count')).toHaveText('1')

  // The tooltip button only appears while hovering the count badge.
  const markRead = todayHeader.locator('.ni-group-mark-read')
  await expect(markRead).toBeHidden()
  await todayHeader.locator('.ni-group-count-wrap').hover()
  await expect(markRead).toBeVisible()

  await markRead.click()

  // Both Today emails flip to read: unread dots go, the badge disappears,
  // and the group stays expanded (the click must not toggle the accordion).
  await expect(page.locator('.ni-row.unread')).toHaveCount(0)
  await expect(todayHeader.locator('.ni-group-count')).toHaveCount(0)
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toBeVisible()
})

test('The installed app icon is badged with the live unread inbox count', async ({ page }) => {
  // Headless engines have no Dock/taskbar, so record what the app asks the
  // Badging API for while driving the real inbox.
  await page.addInitScript(() => {
    globalThis.appBadgeCalls = []
    for (const name of ['setAppBadge', 'clearAppBadge']) {
      Object.defineProperty(navigator, name, {
        configurable: true,
        value: (count = 0) => {
          globalThis.appBadgeCalls.push(count)
          return Promise.resolve()
        },
      })
    }
  })
  await page.goto('/inbox')

  const unreadBadge = page.locator('.nav-item', { hasText: 'Inbox' }).locator('.nav-badge')
  const unreadCount = Number(await unreadBadge.textContent())
  expect(unreadCount).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => globalThis.appBadgeCalls.at(-1))).toBe(unreadCount)

  // Opening an unread email marks it read, and the icon badge follows.
  await page.locator('.ni-row.unread').first().click()
  await expect(unreadBadge).toHaveText(String(unreadCount - 1))
  await expect
    .poll(() => page.evaluate(() => globalThis.appBadgeCalls.at(-1)))
    .toBe(unreadCount - 1)
})

test('Newsletters offer one-click Unsubscribe in the reader', async ({ page }) => {
  await page.goto('/inbox')

  // The Daily Bites newsletter is uncategorised, so it sits under the Other
  // tab, in the collapsed "Last seven days" group.
  await page.locator('.ni-tab', { hasText: 'Other' }).click()
  await page.locator('.ni-group-header', { hasText: 'Last seven days' }).click()
  await page.locator('.ni-row', { hasText: 'Daily Bites' }).click()

  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()
  const actions = reader.locator('.ni-reader-topbar .ni-reader-nav').last()
  const unsubscribe = actions.locator('[title="Unsubscribe"]')
  await expect(unsubscribe).toBeVisible()
  await expect(actions.locator('[title="Star"]')).toBeVisible()
  await expect(actions.locator('[title="Done"]')).toBeVisible()
  await expect(actions.locator('[title="Reschedule"]')).toBeVisible()

  await unsubscribe.click()
  await expect(page.locator('.toast', { hasText: 'Unsubscribed from Daily Bites' })).toBeVisible()
  await expect(reader).toHaveCount(0)
  await expect(page.locator('.ni-row', { hasText: 'Daily Bites' })).toHaveCount(0)

  // A regular email shows no Unsubscribe control.
  await page.locator('.ni-tab', { hasText: 'Important' }).click()
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(reader).toBeVisible()
  await expect(reader.locator('[title="Unsubscribe"]')).toHaveCount(0)
})

test('Sent view lists the outbox with recipients and opens the reader', async ({ page }) => {
  await page.goto('/inbox')

  await page.locator('.nav-item', { hasText: 'More' }).click()
  await page.locator('.nav-item', { hasText: 'Sent' }).click()

  await expect(page.locator('.ni-header h1')).toHaveText('Sent')
  const rows = page.locator('.ni-row')
  await expect(rows).not.toHaveCount(0)
  await expect(rows.first()).toContainText('To: info@citytileandstone.com')
  await expect(rows.first().locator('.ni-read-status')).toContainText('Opened')
  await expect(rows.first().locator('.ni-read-status')).toHaveAttribute('title', /Opened/)

  await rows.first().click()
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()
  await expect(reader.locator('.ni-reader-subject')).toContainText('Tile Selection')
  await expect(reader.locator('.ni-read-status')).toContainText('Opened')
})

test('Multi-select: checkboxes reveal bulk pills, Done archives, Esc clears', async ({ page }) => {
  await page.goto('/inbox')

  // Only Today starts expanded (one visible email); open Yesterday for more.
  await page.locator('.ni-group-header', { hasText: 'Yesterday' }).click()
  // Checkboxes appear on row hover.
  const rows = page.locator('.ni-row')
  await rows.nth(0).hover()
  await rows.nth(0).locator('.ni-checkbox').click()
  await rows.nth(1).hover()
  await rows.nth(1).locator('.ni-checkbox').click()

  // Checking must select, not open the reader.
  await expect(page.locator('.ni-reader')).toHaveCount(0)
  const bar = page.locator('.ni-bulk-bar')
  await expect(bar).toContainText('2 selected')

  // Esc unchecks everything.
  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)
  await expect(page.locator('.ni-checkbox[aria-checked="true"]')).toHaveCount(0)

  // Bulk Done archives the selected email.
  const cityRow = page.locator('.ni-row', { hasText: 'City Construction' })
  await cityRow.hover()
  await cityRow.locator('.ni-checkbox').click()
  await bar.locator('.ni-bulk-pill', { hasText: 'Done' }).click()
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toHaveCount(0)
  await expect(bar).toHaveCount(0)
})

test('The hidden Done mailbox shows emails after they are marked done', async ({ page }) => {
  await page.goto('/inbox')

  const subject = 'Revised Floor Plan - Natural Light adjustments'
  const row = page.locator('.ni-row', { hasText: subject })
  await row.hover()
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(MESSAGES_API_URL) && response.request().method() === 'PATCH',
    ),
    row.locator('[title="Done"]').click(),
  ])

  await page.goto('/inbox?filter=done')

  await expect(page.locator('.ni-header h1')).toHaveText('Done')
  await expect(page.locator('.ni-row', { hasText: subject })).toBeVisible()
  await expect(page.locator('.nav-item', { hasText: 'Done' })).toHaveCount(0)

  await page.locator('.ni-row', { hasText: subject }).click()
  const reader = page.locator('.ni-reader')
  await expect(reader.locator('.ni-reader-subject-text')).toHaveText(subject)
  await expect(reader.locator('[title="Done"]')).toHaveCount(0)
  await expect(reader.locator('[title="Reschedule"]')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/cookie-web-done-mailbox.png', fullPage: true })
})

test('Marking the last email Done shows the Inbox Zero success state', async ({ page }) => {
  await page.route(`${EMAILS_API_URL}/emails?limit=50`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        emails: [
          {
            id: 'inbox-zero-fixture',
            from_name: 'Final Sender',
            from_address: 'final@example.com',
            subject: 'The final email',
            snippet: 'Mark this one done.',
            body_text: 'Mark this one done.',
            sent_at: new Date().toISOString(),
            is_unread: false,
            is_starred: false,
            is_sent: false,
            has_html: false,
            labels: [],
          },
        ],
        nextCursor: null,
        unreadCount: 0,
      }),
    })
  })

  await page.goto('/inbox')
  const row = page.locator('.ni-row', { hasText: 'The final email' })
  await row.hover()
  await row.locator('[title="Done"]').click()

  const inboxZero = page.locator('.ni-inbox-zero')
  await expect(inboxZero).toBeVisible()
  await expect(inboxZero).toHaveText('No emails in your inbox.')
  await expect(inboxZero.locator('img')).toHaveCount(0)
})

test('Sidebar links open the filtered views', async ({ page }) => {
  await page.goto('/inbox')

  await page.locator('.nav-item', { hasText: 'Starred' }).click()
  await expect(page).toHaveURL(/filter=starred/)
  await expect(page.locator('.ni-row')).toHaveCount(2)

  await page.locator('.nav-item', { hasText: 'More' }).click()

  // Snoozed, Scheduled and Spam are listed only while they hold something,
  // and no fixture mail is snoozed, queued to send later, or spam.
  await expect(page.locator('.nav-item', { hasText: 'Snoozed' })).toHaveCount(0)
  await expect(page.locator('.nav-item', { hasText: 'Scheduled' })).toHaveCount(0)
  await expect(page.locator('.nav-item', { hasText: 'Spam' })).toHaveCount(0)

  // Done lives in the expanded More area, directly above Sent.
  const moreItems = page.locator('.sidebar-nav .nav-item')
  const labels = await moreItems.allInnerTexts()
  const doneIndex = labels.findIndex((text) => text.includes('Done'))
  const sentIndex = labels.findIndex((text) => text.includes('Sent'))
  expect(doneIndex).toBeGreaterThan(-1)
  expect(sentIndex).toBe(doneIndex + 1)

  await page.locator('.nav-item', { hasText: 'Done' }).click()
  await expect(page.locator('.ni-header h1')).toHaveText('Done')
  await expect(page.locator('.ni-empty')).toHaveText('No emails marked done.')
})

test('Tags can be added to and removed from an email in the reader', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto('/inbox')
  // Open a known email (fixture-1 carries the "Home" label, not "Finance").
  await page.locator('.ni-row', { hasText: 'Revised Floor Plan' }).click()
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()

  const readerLabels = reader.locator('.ni-reader-labels')
  await expect(readerLabels.locator('.ni-label-pill', { hasText: 'Home' })).toBeVisible()
  await expect(readerLabels.locator('.ni-label-pill', { hasText: 'Finance' })).toHaveCount(0)

  // Open the tag menu and apply a label the email doesn't have yet.
  await reader.locator('.ni-tag-wrap button[title="Tag"]').click()
  const menu = reader.locator('.ni-tag-menu')
  await expect(menu).toBeVisible()
  await menu.locator('.ni-tag-item', { hasText: 'Finance' }).click()

  await expect(readerLabels.locator('.ni-label-pill', { hasText: 'Finance' })).toBeVisible()
  await expect(menu.locator('.ni-tag-item.applied', { hasText: 'Finance' })).toBeVisible()

  // Toggling the same label again removes it.
  await menu.locator('.ni-tag-item', { hasText: 'Finance' }).click()
  await expect(readerLabels.locator('.ni-label-pill', { hasText: 'Finance' })).toHaveCount(0)

  // Clicking elsewhere in the reader closes the menu but keeps the reader open.
  await reader.locator('.ni-reader-subject').click()
  await expect(menu).toBeHidden()
  await expect(reader).toBeVisible()

  expect(pageErrors).toEqual([])
})

test('A reader email can have one Category which can be replaced or cleared', async ({ page }) => {
  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'Revised Floor Plan' }).click()
  const reader = page.locator('.ni-reader')

  await expect(reader.locator('.ni-category-pill')).toHaveCount(0)
  await reader.getByRole('button', { name: 'Set category' }).click()
  const menu = reader.locator('.ni-tag-menu', { hasText: 'No category' })
  await expect(menu.getByRole('menuitemradio', { name: 'Projects' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await menu.getByRole('menuitemradio', { name: 'Personal' }).click()
  await expect(reader.locator('.ni-category-pill')).toHaveCount(0)

  await reader.getByRole('button', { name: 'Set category' }).click()
  await expect(menu.getByRole('menuitemradio', { name: 'Personal' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await menu.getByRole('menuitemradio', { name: 'No category' }).click()
  await reader.getByRole('button', { name: 'Set category' }).click()
  await expect(menu.getByRole('menuitemradio', { name: 'No category' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(reader.locator('.ni-category-pill')).toHaveCount(0)
})

test('Tasks projects nest, collapse, and survive a reload', async ({ page }) => {
  await page.goto('/tasks')

  const sidebar = page.locator('.tasks-sidebar')
  await expect(sidebar.locator('.nav-item', { hasText: 'Inbox' })).toBeVisible()
  await expect(sidebar.locator('.tasks-projects-empty')).toHaveText('No projects yet')

  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Work')
  await sidebar.locator('.new-project-row input').press('Enter')
  await expect(sidebar.locator('.project-item')).toHaveCount(1)

  // A sub-project appears under its parent, which auto-expands to show it.
  await sidebar.locator('.project-item').hover()
  await sidebar.locator('.project-item .row-action-btn[data-action="add"]').click()
  await sidebar.locator('.new-project-row input').fill('API')
  await sidebar.locator('.new-project-row input').press('Enter')
  await expect(sidebar.locator('.project-item')).toHaveCount(2)

  await sidebar.locator('.project-arrow').click()
  await expect(sidebar.locator('.project-item')).toHaveCount(1)

  await page.reload()
  await expect(sidebar.locator('.project-item')).toHaveCount(1)
  await expect(sidebar.locator('.project-item')).toContainText('Work')
})

test('Tasks: a task can be added to a project and completed', async ({ page }) => {
  await page.goto('/tasks')

  const sidebar = page.locator('.tasks-sidebar')
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Githup')
  await sidebar.locator('.new-project-row input').press('Enter')
  await sidebar.locator('.project-item', { hasText: 'Githup' }).click()

  await expect(page.locator('.tasks-title')).toHaveText('Githup')
  await expect(page.locator('.tasks-description')).toHaveText('Add a description')

  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Add auto-merge feature')
  await page.locator('.add-task-row input').press('Enter')

  await expect(page.locator('.task-row')).toHaveCount(1)
  await expect(page.locator('.task-content')).toHaveText('Add auto-merge feature')

  // Completing hides it from the list; a reload proves the server agrees.
  await page.locator('.task-check').click()
  await expect(page.locator('.task-row')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.task-row')).toHaveCount(0)
})

test('Tasks: rows drag to re-arrange, and onto Today or a project', async ({ page }) => {
  await page.goto('/tasks?project=inbox')
  for (const name of ['First', 'Second', 'Third']) {
    await page.locator('.add-task-btn').click()
    await page.locator('.add-task-row input').fill(name)
    await page.locator('.add-task-row input').press('Enter')
  }
  await expect(page.locator('.task-content')).toHaveText(['First', 'Second', 'Third'])

  // Dropped on the upper half of First, Third lands before it — and the
  // order is the server's, not just the screen's.
  // The grip at the row's edge is the drag source; it shows on hover, which
  // dragTo does before pressing.
  const rows = page.locator('.task-row')
  await rows
    .nth(2)
    .locator('.task-grip')
    .dragTo(rows.nth(0), { targetPosition: { x: 40, y: 3 } })
  await expect(page.locator('.task-content')).toHaveText(['Third', 'First', 'Second'])
  await page.reload()
  await expect(page.locator('.task-content')).toHaveText(['Third', 'First', 'Second'])

  // Onto Today: the task stays in the Inbox and is now due today.
  const sidebar = page.locator('.tasks-sidebar')
  await page
    .locator('.task-row', { hasText: 'Second' })
    .locator('.task-grip')
    .dragTo(sidebar.locator('.nav-item', { hasText: 'Today' }))
  await sidebar.locator('.nav-item', { hasText: 'Today' }).click()
  await expect(page.locator('.task-content')).toHaveText(['Second'])

  // Onto a project: the task leaves the Inbox for it.
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Work')
  await sidebar.locator('.new-project-row input').press('Enter')
  await sidebar.locator('.nav-item', { hasText: 'Inbox' }).click()
  await expect(page.locator('.task-content')).toHaveText(['Third', 'First', 'Second'])
  await page
    .locator('.task-row', { hasText: 'First' })
    .locator('.task-grip')
    .dragTo(sidebar.locator('.project-item', { hasText: 'Work' }))
  await expect(page.locator('.task-content')).toHaveText(['Third', 'Second'])
  await sidebar.locator('.project-item', { hasText: 'Work' }).click()
  await expect(page.locator('.task-content')).toHaveText(['First'])
})

test('Tasks: a divider is added from the line under a row and deleted from its middle', async ({
  page,
}) => {
  await page.goto('/tasks?project=inbox')
  for (const name of ['First', 'Second']) {
    await page.locator('.add-task-btn').click()
    await page.locator('.add-task-row input').fill(name)
    await page.locator('.add-task-row input').press('Enter')
  }
  await expect(page.locator('.task-content')).toHaveText(['First', 'Second'])

  // The plus lives on the line under First; resting the pointer there shows
  // it. The divider lands between the two, and the server keeps it there.
  const line = page.locator('.task-insert').first()
  await line.hover()
  await line.locator('.task-insert-btn').click()
  const rows = page.locator('.task-rows > .task-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1)).toHaveClass(/task-divider/)
  await page.reload()
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1)).toHaveClass(/task-divider/)

  // Deleted from its midpoint, with nothing to confirm.
  const divider = page.locator('.task-divider')
  await divider.hover()
  await divider.locator('.divider-delete').click()
  await expect(rows).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.task-content')).toHaveText(['First', 'Second'])
  await expect(page.locator('.task-divider')).toHaveCount(0)
})

test('Tasks: a task opens in the panel, takes a date, and the link survives a reload', async ({
  page,
}) => {
  await page.goto('/tasks?project=inbox')

  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Ship the panel')
  await page.locator('.add-task-row input').press('Enter')
  await expect(page.locator('.task-row')).toHaveCount(1)

  await page.locator('.task-open').click()
  await expect(page.locator('.task-panel')).toBeVisible()
  await expect(page.locator('.task-panel-title')).toHaveText('Ship the panel')

  await page.locator('.task-panel-date-input').fill('2026-09-01')
  await expect(page.locator('.task-due')).toHaveText('1 Sep')

  // URL-backed: the panel is a link, not view state that a reload forgets.
  await page.reload()
  await expect(page.locator('.task-panel')).toBeVisible()
  await expect(page.locator('.task-panel-title')).toHaveText('Ship the panel')
  await expect(page.locator('.task-panel-date-input')).toHaveValue('2026-09-01')

  await page.keyboard.press('Escape')
  await expect(page.locator('.task-panel')).toHaveCount(0)
  await expect(page.locator('.task-row')).toHaveCount(1)
})

test('Tasks: sub-tasks are added and completed in the panel, and stay out of the list', async ({
  page,
}) => {
  await page.goto('/tasks?project=inbox')

  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Investigate this animation style')
  await page.locator('.add-task-row input').press('Enter')
  await page.locator('.task-open').click()
  await expect(page.locator('.task-panel')).toBeVisible()

  // Two sub-tasks via the composer; each Enter closes it again.
  await page.locator('.add-subtask-btn').click()
  await page.locator('.add-subtask-row input').fill('Example 1')
  await page.locator('.add-subtask-row input').press('Enter')
  await page.locator('.add-subtask-btn').click()
  await page.locator('.add-subtask-row input').fill('Example 2')
  await page.locator('.add-subtask-row input').press('Enter')

  await expect(page.locator('.subtask-row')).toHaveCount(2)
  await expect(page.locator('.task-subtasks-count')).toHaveText('0/2')

  // Completing one keeps it listed, checked, and counted.
  await page.locator('.subtask-row', { hasText: 'Example 1' }).locator('.subtask-check').click()
  await expect(page.locator('.task-subtasks-count')).toHaveText('1/2')
  await expect(
    page.locator('.subtask-row', { hasText: 'Example 1' }).locator('.subtask-content'),
  ).toHaveClass(/done/)

  // The panel is URL-backed, so the sub-tasks survive a reload intact.
  await page.reload()
  await expect(page.locator('.subtask-row')).toHaveCount(2)
  await expect(page.locator('.task-subtasks-count')).toHaveText('1/2')

  // The list behind the panel shows only the top-level task.
  await page.locator('.task-panel-close').click()
  await expect(page.locator('.task-row')).toHaveCount(1)
})

test('Tasks: Today lists what is due today from across the projects', async ({ page }) => {
  await page.goto('/tasks')

  // The app asks for its own local date, so the test has to use the same one.
  const today = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const sidebar = page.locator('.tasks-sidebar')
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Roof')
  await sidebar.locator('.new-project-row input').press('Enter')
  await sidebar.locator('.project-item', { hasText: 'Roof' }).click()

  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Due today')
  await page.locator('.add-task-row input').press('Enter')
  await expect(page.locator('.task-row')).toHaveCount(1)

  await page.locator('.task-open').click()
  await page.locator('.task-panel-date-input').fill(today)
  await page.keyboard.press('Escape')

  // A second task with no date, which Today must leave behind.
  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Someday')
  await page.locator('.add-task-row input').press('Enter')
  await expect(page.locator('.task-row')).toHaveCount(2)

  await sidebar.locator('.nav-item', { hasText: 'Today' }).click()

  await expect(page.locator('.tasks-title')).toHaveText('Today')
  await expect(page.locator('.task-row')).toHaveCount(1)
  await expect(page.locator('.task-content')).toHaveText('Due today')
  // The rows span projects, so each names where it lives.
  await expect(page.locator('.task-home')).toHaveText('Roof')
  // Nothing to name or describe, and no one project a new task would join.
  await expect(page.locator('.add-task-btn')).toHaveCount(0)
  await expect(page.locator('.tasks-description')).toHaveCount(0)
})

test('Tasks: Add Task creates in the Inbox from wherever you are', async ({ page }) => {
  await page.goto('/tasks')

  const sidebar = page.locator('.tasks-sidebar')
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Roof')
  await sidebar.locator('.new-project-row input').press('Enter')
  await sidebar.locator('.project-item', { hasText: 'Roof' }).click()
  await expect(page.locator('.tasks-title')).toHaveText('Roof')

  await sidebar.getByRole('button', { name: 'Add Task', exact: true }).click()
  await expect(page.locator('.add-task-dialog')).toBeVisible()
  await page.locator('.add-task-dialog-input').fill('Buy milk')
  await page.locator('.add-task-dialog-input').press('Enter')
  await expect(page.locator('.add-task-dialog')).toHaveCount(0)

  // Created in the Inbox, so it must not appear under the open project.
  await expect(page.locator('.task-row')).toHaveCount(0)

  await sidebar.locator('.nav-item', { hasText: 'Inbox' }).click()
  await expect(page.locator('.task-content')).toHaveText('Buy milk')

  // And it is really there, not just in local state.
  await page.reload()
  await expect(page.locator('.task-content')).toHaveText('Buy milk')
})

test('Tasks: natural-language quick add parses into Advanced and saves every field', async ({
  page,
}) => {
  await page.goto('/tasks?project=inbox')

  const sidebar = page.locator('.tasks-sidebar')
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Work')
  await sidebar.locator('.new-project-row input').press('Enter')

  await sidebar.getByRole('button', { name: 'Add Task', exact: true }).click()
  const dialog = page.locator('.add-task-dialog')
  await dialog
    .getByRole('textbox', { name: 'Describe your task' })
    .fill('Call plumber Friday 3pm p1 #Work @home')
  await dialog.getByRole('button', { name: 'Advanced' }).click()

  await expect(dialog.getByRole('textbox', { name: 'Task name' })).toHaveValue('Call plumber')
  await expect(dialog.getByRole('combobox', { name: 'Project' })).toHaveValue(/.+/)
  await expect(dialog.getByLabel('Due date')).not.toHaveValue('')
  await expect(dialog.getByLabel('Due time')).toHaveValue('15:00')
  await expect(dialog.getByRole('combobox', { name: 'Priority' })).toHaveValue('1')
  await expect(dialog.getByRole('textbox', { name: 'Labels' })).toHaveValue('@home')

  await dialog.getByRole('button', { name: 'Add task' }).click()
  await expect(dialog).toHaveCount(0)
  await sidebar.locator('.project-item', { hasText: 'Work' }).click()

  await expect(page.locator('.task-content')).toHaveText('Call plumber')
  await expect(page.locator('.task-due')).toContainText('3:00 PM')
  await expect(page.locator('.task-label')).toHaveText('@home')
})

test('Tasks: the Add Task dialog closes on Escape without creating anything', async ({ page }) => {
  await page.goto('/tasks')

  await page.getByRole('button', { name: 'Add Task', exact: true }).click()
  await page.locator('.add-task-dialog-input').fill('Never mind')
  await page.keyboard.press('Escape')

  await expect(page.locator('.add-task-dialog')).toHaveCount(0)
  await expect(page.locator('.task-row')).toHaveCount(0)
})

test('Tasks: an overdue task is carried into Today and can be deleted', async ({ page }) => {
  await page.goto('/tasks')

  const sidebar = page.locator('.tasks-sidebar')
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Roof')
  await sidebar.locator('.new-project-row input').press('Enter')
  await sidebar.locator('.project-item', { hasText: 'Roof' }).click()

  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Long overdue')
  await page.locator('.add-task-row input').press('Enter')

  // A date well in the past: Today must still carry it.
  await page.locator('.task-open').click()
  await page.locator('.task-panel-date-input').fill('2020-01-02')
  await page.keyboard.press('Escape')

  await sidebar.locator('.nav-item', { hasText: 'Today' }).click()
  await expect(page.locator('.task-content')).toHaveText('Long overdue')
  // Dated and flagged, because it no longer shares Today's date.
  await expect(page.locator('.task-due')).toHaveText('2 Jan')
  await expect(page.locator('.task-due')).toHaveClass(/overdue/)

  // Delete it from the panel's header icon.
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.task-open').click()
  await page.locator('.task-panel-delete').click()

  await expect(page.locator('.task-panel')).toHaveCount(0)
  await expect(page.locator('.task-row')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.task-row')).toHaveCount(0)
})

test('Tasks: a task can be deleted from the list without opening it', async ({ page }) => {
  await page.goto('/tasks?project=inbox')

  await page.locator('.add-task-btn').click()
  await page.locator('.add-task-row input').fill('Delete me from the list')
  await page.locator('.add-task-row input').press('Enter')
  await expect(page.locator('.task-row')).toHaveCount(1)

  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.task-row').hover()
  await page.locator('.task-delete').click()

  // Gone, and the panel never opened.
  await expect(page.locator('.task-row')).toHaveCount(0)
  await expect(page.locator('.task-panel')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.task-row')).toHaveCount(0)
})

// The sidebar's per-row controls used to sit in the flow of the row, so every
// project name permanently lost 42px to buttons that are invisible until you
// hover — clipping nested names like "Home Dashboard" to "Home Das…". jsdom
// performs no layout, so only a real browser can catch this.
test('Tasks: a nested project name is not clipped by the row controls', async ({ page }) => {
  await page.goto('/tasks')

  const sidebar = page.locator('.tasks-sidebar')
  await sidebar.locator('.new-project-btn').click()
  await sidebar.locator('.new-project-row input').fill('Personal')
  await sidebar.locator('.new-project-row input').press('Enter')

  const parent = sidebar.locator('.project-item', { hasText: 'Personal' }).first()
  await parent.hover()
  await parent.locator('[data-action="add"]').click()
  await sidebar.locator('.new-project-row input').fill('Home Dashboard')
  await sidebar.locator('.new-project-row input').press('Enter')

  const nested = sidebar.locator('.project-item', { hasText: 'Home Dashboard' }).first()
  await expect(nested).toBeVisible()

  const clipped = await nested.locator('.nav-text').evaluate((el) => ({
    avail: el.clientWidth,
    needed: el.scrollWidth,
  }))
  expect(clipped.needed).toBeLessThanOrEqual(clipped.avail)

  // The controls are out of the row's flow; in it, they take the space back.
  const position = await nested
    .locator('.row-actions')
    .evaluate((el) => getComputedStyle(el).position)
  expect(position).toBe('absolute')
})

// .tasks-view is a flex item in .main-content's column flex container, so its
// cross axis is horizontal and `margin: 0 auto` there beats align-items:
// stretch — which sizes the box to its content unless a width is stated. With
// no width the column collapsed to the width of its widest row (~150px) and
// floated into the middle of the panel. jsdom has no layout, so only a real
// browser can catch this.
test('The Tasks column fills its panel rather than collapsing to its content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/tasks')
  await expect(page.locator('.tasks-title')).toBeVisible()

  // The sidebar slides in after first paint, so the panel's box settles a
  // moment after the title shows; a one-shot measurement occasionally lands
  // mid-animation with the whole sidebar width as skew. Poll until centred.
  const boxes = async () => {
    const view = await page.locator('.tasks-view').boundingBox()
    const panel = await page.locator('.main-content').boundingBox()
    const leftGap = view.x - panel.x
    const rightGap = panel.x + panel.width - (view.x + view.width)
    return { view, panel, skew: Math.abs(leftGap - rightGap) }
  }
  await expect.poll(async () => (await boxes()).skew).toBeLessThanOrEqual(1)

  const { view, panel } = await boxes()
  expect(view.width).toBe(Math.min(900, panel.width))
})

test('Inbox tabs open on Important, narrow by category, and Other holds the rest', async ({
  page,
}) => {
  await page.goto('/inbox')

  const tabs = page.locator('.ni-tabs .ni-tab')
  await expect(tabs.first()).toHaveText(/^Important\s*2$/)
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.last()).toHaveText(/^Other\s*\d+$/)
  const priorityRow = page.locator('.ni-row', { hasText: 'City Construction' })
  await expect(page.locator('.ni-row')).toHaveCount(1)
  await expect(priorityRow).toBeVisible()

  await page.locator('.ni-tab', { hasText: 'Projects' }).click()
  await expect(priorityRow).toBeVisible()
  await expect(page.locator('.ni-row .ni-category-pill')).toHaveCount(0)

  await page.locator('.ni-tab', { hasText: 'Other' }).click()
  await expect(priorityRow).toHaveCount(0)
  await expect(page.locator('.ni-row .ni-category-pill')).toHaveCount(0)

  // The choice survives leaving the inbox and coming back.
  await page.locator('.ni-tab', { hasText: 'Projects' }).click()
  await page.locator('.nav-item', { hasText: 'Starred' }).click()
  await expect(page.locator('.ni-tabs')).toHaveCount(0)
  await page.locator('.nav-item', { hasText: 'Inbox' }).first().click()
  await expect(page.locator('.ni-tab', { hasText: 'Projects' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})
