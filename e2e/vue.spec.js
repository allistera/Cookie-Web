import { test, expect } from '@playwright/test'

test('Visits Gmail AI Inbox and performs task checkoff', async ({ page }) => {
  await page.goto('/')
  
  // 1. Check greeting contains Allister
  const greeting = page.locator('#aiGreeting')
  await expect(greeting).toContainText('Hi Allister')
  
  // 2. Check initial to-do count
  const counter = page.locator('#todoCounter')
  await expect(counter).toContainText('5 to-dos')
  
  // 3. Locate the RSVP for College Tour row
  const collegeTourRow = page.locator('#todo-waiver')
  await expect(collegeTourRow).toBeVisible()
  
  // 4. Click the check mark button inside the RSVP for College Tour row
  const checkBtn = collegeTourRow.locator('.todo-check-btn').first()
  await checkBtn.click()
  
  // 5. Wait for the row to fade and vanish (transition completed)
  await expect(collegeTourRow).not.toBeVisible({ timeout: 10000 })
  
  // 6. Verify that the counter updated to 4 to-dos
  await expect(counter).toContainText('4 to-dos')
  
  // 7. Verify that the next task (Resale Marketplace Sale) was promoted
  const marketplaceRow = page.locator('#todo-marketplace')
  await expect(marketplaceRow).toBeVisible()
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

test('Clicking an inbox email slides in the reading panel', async ({ page }) => {
  await page.goto('/inbox')

  // Header no longer has display/settings/refresh icon buttons
  await expect(page.locator('.ni-header .ni-icon-btn')).toHaveCount(0)

  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  const reader = page.locator('.ni-reader')
  await expect(reader).toBeVisible()
  await expect(reader.locator('.ni-reader-subject')).toContainText('Revised Floor Plan')

  // Next moves to the following email
  await reader.locator('[title="Next"]').click()
  await expect(reader.locator('.ni-reader-subject')).toContainText('Claim #99281')

  // Close slides the panel away
  await reader.locator('.ni-reader-close').click()
  await expect(page.locator('.ni-reader')).toHaveCount(0)

  // Clicking outside the panel also closes it
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(page.locator('.ni-reader')).toBeVisible()
  await page.locator('.ni-title h1').click()
  await expect(page.locator('.ni-reader')).toHaveCount(0)
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

  // Searching from the AI inbox navigates to the traditional inbox with results.
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

  const searchInput = page.locator('.search-input')
  await searchInput.click()
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

test('Settings Labels pane lists labels and creates a new one', async ({ page }, testInfo) => {
  // The dev-server labels stub is shared across browser projects and retries;
  // a unique name keeps this test isolated.
  const labelName = `Receipts-${testInfo.project.name}-${testInfo.retry}`
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

test('Hovering the Today unread count reveals Mark Read, which clears the day', async ({
  page,
}) => {
  await page.goto('/inbox')

  const todayHeader = page.locator('.ni-group-header', { hasText: 'Today' })
  await expect(todayHeader.locator('.ni-group-count')).toHaveText('2')

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
