import { test, expect } from '@playwright/test'

test('The root path redirects to the inbox', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('.ni-row').first()).toBeVisible()
})

test('Profile dropdown contains Settings and Log out, and opens the settings modal', async ({
  page,
}) => {
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto('/')

  // Settings cog is no longer in the header
  await expect(page.locator('.header-right .icon-btn[title="Settings"]')).toHaveCount(0)

  // Clicking the avatar opens the dropdown
  await page.locator('.profile-container').click()
  const settingsItem = page.locator('.dropdown-menu-btn', { hasText: 'Settings' })
  const logoutItem = page.locator('.logout-btn', { hasText: 'Log out' })
  await expect(settingsItem).toBeVisible()
  await expect(logoutItem).toBeVisible()

  // Settings item opens the settings modal and closes the dropdown
  await settingsItem.click()
  await expect(page.locator('.settings-modal-container')).toBeVisible()
  await expect(page.locator('.profile-dropdown')).toHaveCount(0)
  await expect(page.locator('.settings-modal-container')).toContainText('Notifications')

  // Log out must not throw (regression: window is not accessible in template scope)
  await page.locator('.settings-modal-container .btn-secondary').click()
  await page.locator('.profile-container').click()
  await page.locator('.logout-btn').click()
  expect(pageErrors).toEqual([])
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
  await composer.locator('textarea').fill('A message that should only send once.')
  const sendButton = composer.locator('.composer-text-btn-primary')
  await sendButton.click()

  await requestStarted
  await expect(sendButton).toBeDisabled()
  await expect(sendButton).toHaveText('Sending…')
  expect(sendRequests).toBe(1)

  releaseSend()
  await expect(composer).not.toHaveClass(/active/)
  expect(sendRequests).toBe(1)
})

test('Clicking an inbox email slides in the reading panel', async ({ page }) => {
  await page.goto('/inbox')

  // Header no longer has display/settings/refresh icon buttons
  await expect(page.locator('.ni-header .ni-icon-btn')).toHaveCount(0)

  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()
  await expect(reader.locator('.ni-reader-subject')).toContainText('Revised Floor Plan')

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
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(page.locator('.ni-reader')).toBeVisible()
  await page.locator('.ni-title h1').click()
  await expect(page.locator('.ni-reader')).toHaveCount(0)
})

test("Pressing 'd' after opening an email link marks it Done", async ({ page }) => {
  await page.goto('/inbox')

  const subject = 'Revised Floor Plan - Natural Light adjustments'
  const row = page.locator('.ni-row', { hasText: subject })
  await row.click()
  const reader = page.locator('.ni-reader')
  await expect(reader.locator('.ni-reader-subject')).toHaveText(subject)

  const emailLink = reader
    .frameLocator('iframe[title="Email content"]')
    .getByRole('link', { name: 'View the full plan' })
  // Keep this test in the inbox tab while still exercising a real link click;
  // external navigation itself is unrelated to the focus-boundary regression.
  await emailLink.evaluate((link) =>
    link.addEventListener('click', (event) => event.preventDefault(), { once: true }),
  )
  await emailLink.click()
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => {
        if (!candidate.url().includes('/api/messages') || candidate.request().method() !== 'PATCH') {
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
  await expect(reader.locator('.ni-reader-subject')).toContainText('Soccer Snacks')

  await page.goto('/inbox?filter=done')
  await expect(page.locator('.ni-row', { hasText: subject })).toBeVisible()
})

test('Reader Summarize shows a loading indicator and renders the AI thread summary', async ({
  page,
}) => {
  let releaseSummary
  let requestBody
  let notifyRequestStarted
  const requestStarted = new Promise((resolve) => {
    notifyRequestStarted = resolve
  })
  const summaryHeld = new Promise((resolve) => {
    releaseSummary = resolve
  })
  await page.route('**/api/summarize', async (route) => {
    requestBody = route.request().postDataJSON()
    notifyRequestStarted()
    await summaryHeld
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        summary:
          'City Construction shared a revised plan.\n\n• Review the updated room dimensions.\n• Reply with any layout changes.',
      }),
    })
  })

  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  const reader = page.locator('.ni-reader')
  const summarize = reader.locator('.ni-summarize-btn')

  await expect(summarize).toHaveText(/Summarize/)
  await summarize.click()
  await requestStarted

  expect(requestBody).toEqual({ id: 'fixture-1' })
  await expect(summarize).toBeDisabled()
  await expect(summarize).toHaveText(/Summarizing…/)
  await expect(summarize.locator('.ni-summary-spinner')).toBeVisible()

  releaseSummary()
  const summary = reader.locator('.ni-reader-labels + .ni-summary-box')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('AI summary')
  await expect(summary).toContainText('City Construction shared a revised plan.')
  await expect(summarize).toBeEnabled()
  await expect(summarize).toHaveText(/Regenerate Summary/)
})

test('Reader restores a saved AI summary and offers to regenerate it', async ({ page }) => {
  await page.goto('/inbox')
  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  await row.click()

  let reader = page.locator('.ni-reader')
  await reader.locator('.ni-summarize-btn').click()
  await expect(reader.locator('.ni-summary-box')).toContainText(
    'City Construction shared a revised kitchen floor plan',
  )
  await expect(reader.locator('.ni-summarize-btn')).toHaveText(/Regenerate Summary/)

  await page.reload()
  await row.click()
  reader = page.locator('.ni-reader')

  await expect(reader.locator('.ni-summary-box')).toContainText(
    'City Construction shared a revised kitchen floor plan',
  )
  await expect(reader.locator('.ni-summarize-btn')).toHaveText(/Regenerate Summary/)
})

test('Reader scheduling offers Tomorrow and Next Week, then removes the email until it is due', async ({
  page,
}) => {
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
  // Scheduling follows the same triage flow as Done: the next email opens.
  await expect(reader.locator('.ni-reader-subject')).toContainText('Soccer Snacks')

  const coachRow = page.locator('.ni-row', { hasText: 'Coach Mike' })
  await reader.locator('[title="Star"]').click()
  await expect(reader).toHaveCount(0)
  await expect(coachRow).toHaveCount(0)

  await page.locator('.nav-item', { hasText: 'Starred' }).click()
  await expect(page).toHaveURL(/filter=starred/)
  await expect(page.locator('.ni-row', { hasText: 'Coach Mike' })).toBeVisible()
})

test('A due scheduled email appears at the top in the conditional Due Today group', async ({
  page,
}) => {
  await page.route('**/api/emails?limit=50', async (route) => {
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
  nextWeek.setDate(nextWeek.getDate() + (((8 - nextWeek.getDay()) % 7) || 7))
  nextWeek.setHours(8, 0, 0, 0)

  await page.route('**/api/emails?folder=snoozed&limit=50', async (route) => {
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
  await replyBox.locator('.ni-reply-textarea').fill('Thanks, the revised plan looks great.')
  await replyBox.locator('.btn-primary').click()

  await expect(reader.locator('.ni-reply-box')).toHaveCount(0)
  await expect(page.locator('.toast', { hasText: 'Reply sent.' })).toBeVisible()
})

test('Header search filters the inbox and clearing restores it', async ({ page }) => {
  await page.goto('/')

  const searchInput = page.locator('.search-input')
  await searchInput.fill('zoom')
  await searchInput.press('Enter')
  await expect(page).toHaveURL(/\/inbox$/)

  const rows = page.locator('.ni-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Zoom Video')

  // Clearing the search restores the full inbox (Today group, newest first).
  await page.locator('.search-clear-icon').click()
  await expect(page.locator('.ni-row').first()).toContainText('City Construction')
})

test('Ask Cookie answers with formatted text and email sources', async ({ page }) => {
  await page.goto('/')

  // Typing in the search bar offers an "Ask Cookie" item that sends the text
  // to the Q&A assistant instead of the search index.
  const searchInput = page.locator('.search-input')
  await searchInput.fill('Summarize my kitchen renovation updates.')
  await page
    .locator('.suggestion-item', { hasText: 'kitchen renovation' })
    .click()

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
  await page.route('**/api/messages', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  )
  await page.goto('/inbox')

  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  const starBtn = row.locator('[title="Star"]')
  await row.hover()
  await starBtn.click()

  await expect(page.locator('.toast', { hasText: 'Failed to update starred state.' })).toBeVisible()
  await expect(starBtn).not.toHaveClass(/starred/)
})

test('Settings Labels pane lists, creates and renames labels', async ({ page }, testInfo) => {
  // The dev-server labels stub is shared across browser projects and retries;
  // a unique name keeps this test isolated.
  const labelSuffix = `${testInfo.project.name}-${testInfo.retry}-${Date.now()}`
  const labelName = `Receipts-${labelSuffix}`
  await page.goto('/')

  // Open settings via the profile dropdown
  await page.locator('.profile-container').click()
  await page.locator('.dropdown-menu-btn', { hasText: 'Settings' }).click()
  const modal = page.locator('.settings-modal-container')
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
  const renamedLabel = `Renamed-${labelSuffix}`
  await modal.getByTitle(`Rename ${labelName}`).click()
  const renameInput = modal.getByLabel(`Rename ${labelName}`)
  await renameInput.fill(renamedLabel)
  await renameInput.press('Enter')
  await expect(modal.locator('.ni-label-pill', { hasText: renamedLabel })).toBeVisible()
  await expect(modal.locator('.ni-label-pill', { hasText: labelName })).toHaveCount(0)
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

test('Command palette Mark Done archives the open email', async ({ page }) => {
  await page.goto('/inbox')

  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(page.locator('.ni-reader')).toBeVisible()

  await page.keyboard.press('/')
  const firstItem = page.locator('.cp-item').first()
  await expect(firstItem).toContainText('Mark Done')
  await expect(firstItem.locator('.cp-keycap')).toHaveText('E')
  await page.keyboard.press('Enter')

  await expect(page.locator('.cp-panel')).toBeHidden()
  await expect(page.locator('.ni-reader')).toHaveCount(0)
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toHaveCount(0)
  await expect(page.locator('.toast', { hasText: 'Marked done.' })).toBeVisible()
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
  await page.route('**/api/emails**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await route.continue()
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

test('Newsletters offer one-click Unsubscribe in the reader', async ({ page }) => {
  await page.goto('/inbox')

  // The Daily Bites newsletter lives in the collapsed "Last seven days" group.
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
  await expect(page.locator('.toast')).toContainText('Unsubscribed from Daily Bites')
  await expect(unsubscribe).toContainText('Unsubscribed')
  await expect(unsubscribe).toBeDisabled()

  // A regular email shows no Unsubscribe control.
  await page.keyboard.press('Escape')
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

  await rows.first().click()
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()
  await expect(reader.locator('.ni-reader-subject')).toContainText('Tile Selection')
})

test('Multi-select: checkboxes reveal bulk pills, Done archives, Esc clears', async ({
  page,
}) => {
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
      (response) => response.url().includes('/api/messages') && response.request().method() === 'PATCH',
    ),
    row.locator('[title="Done"]').click(),
  ])

  await page.goto('/inbox?filter=done')

  await expect(page.locator('.ni-header h1')).toHaveText('Done')
  await expect(page.locator('.ni-row', { hasText: subject })).toBeVisible()
  await expect(page.locator('.nav-item', { hasText: 'Done' })).toHaveCount(0)

  await page.locator('.ni-row', { hasText: subject }).click()
  const reader = page.locator('.ni-reader')
  await expect(reader.locator('.ni-reader-subject')).toHaveText(subject)
  await expect(reader.locator('[title="Done"]')).toHaveCount(0)
  await expect(reader.locator('[title="Reschedule"]')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/cookie-web-done-mailbox.png', fullPage: true })
})

test('Marking the last email Done shows the Inbox Zero success state', async ({ page }) => {
  await page.route('**/api/emails?limit=50', async (route) => {
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
  await expect(inboxZero).toContainText('Welcome to Inbox Zero')
  await expect(inboxZero.locator('.ni-inbox-zero-icon')).toHaveText('task_alt')
  await expect(inboxZero.locator('.ni-inbox-zero-icon')).toHaveCSS('font-size', '84px')
})

test('Sidebar links open the filtered views', async ({ page }) => {
  await page.goto('/inbox')

  await page.locator('.nav-item', { hasText: 'Starred' }).click()
  await expect(page).toHaveURL(/filter=starred/)
  await expect(page.locator('.ni-row')).toHaveCount(2)

  await page.locator('.nav-item', { hasText: 'More' }).click()
  await page.locator('.nav-item', { hasText: 'Snoozed' }).click()
  await expect(page.locator('.ni-header h1')).toHaveText('Snoozed')
  await expect(page.locator('.ni-empty')).toHaveText('No snoozed emails yet.')
})
