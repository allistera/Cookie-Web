import { expect, test } from './workerFixtures.js'

// Opens Settings from the profile dropdown and switches to the Rules pane.
async function openRulesSettings(page) {
  if (!new URL(page.url()).pathname.startsWith('/settings')) {
    await page.locator('.profile-container').click()
    await page.locator('.dropdown-menu-btn', { hasText: 'Settings' }).click()
  }
  const modal = page.locator('.settings-page')
  await expect(modal).toBeVisible()
  await modal.locator('.settings-nav-item', { hasText: 'Rules' }).click()
  return modal
}

test('Settings Rules creates a tag rule that survives a reload', async ({ page }) => {
  await page.goto('/')
  const modal = await openRulesSettings(page)
  await expect(modal.locator('.settings-section-hint', { hasText: 'No rules yet' })).toBeVisible()

  await modal.locator('.rule-editor-form > .label-input').fill('Zoom receipts')
  const condition = modal.locator('.rule-condition-row').first()
  await condition.locator('select').nth(0).selectOption('from')
  await condition.locator('select').nth(1).selectOption('contains')
  await condition.locator('.label-input').fill('billing@zoom.us')
  await modal.getByLabel('Apply label').selectOption({ label: 'Finance' })
  await modal.getByRole('button', { name: 'Add rule' }).click()

  const rule = modal.locator('.rule-row', { hasText: 'Zoom receipts' })
  await expect(rule.locator('.ni-label-pill')).toHaveText('Finance')
  await expect(rule.locator('.rule-row-summary')).toContainText(
    'All of: From contains "billing@zoom.us"',
  )
  await expect(page.locator('.toast', { hasText: 'Rule created.' })).toBeVisible()
  // The draft resets so the form is ready for the next rule.
  await expect(modal.locator('.rule-editor-form > .label-input')).toHaveValue('')

  // The rule came back from the API, not just local state.
  await page.reload()
  const reopened = await openRulesSettings(page)
  await expect(reopened.locator('.rule-row', { hasText: 'Zoom receipts' })).toBeVisible()
})

test('A tag rule can be switched to Mark done, disabled, and deleted', async ({ page }) => {
  await page.goto('/')
  const modal = await openRulesSettings(page)

  await modal.locator('.rule-editor-form > .label-input').fill('Archive newsletters')
  const first = modal.locator('.rule-condition-row').first()
  await first.locator('select').nth(0).selectOption('body')
  await first.locator('.label-input').fill('unsubscribe')
  await modal.getByLabel('Apply label').selectOption({ label: 'Newsletters' })
  await modal.getByRole('button', { name: 'Add rule' }).click()

  const rule = modal.locator('.rule-row', { hasText: 'Archive newsletters' })
  await expect(rule.locator('.ni-label-pill')).toHaveText('Newsletters')

  // Switching the action to mark_done drops the label the rule carried, and
  // adds a second condition matched with "any".
  await rule.getByTitle('Edit Archive newsletters').click()
  await modal.getByRole('button', { name: '+ Add condition' }).click()
  const second = modal.locator('.rule-condition-row').nth(1)
  await second.locator('select').nth(0).selectOption('subject')
  await second.locator('select').nth(1).selectOption('starts_with')
  await second.locator('.label-input').fill('Weekly digest')
  await modal.getByLabel('Match').selectOption('any')
  await modal.getByLabel('Action').selectOption('mark_done')
  await expect(modal.getByLabel('Apply label')).toHaveCount(0)
  await modal.getByRole('button', { name: 'Save rule' }).click()

  await expect(rule.locator('.ni-label-pill')).toHaveText('Mark done')
  await expect(rule.locator('.rule-row-summary')).toContainText(
    'Any of: Body contains "unsubscribe" · or Subject starts with "Weekly digest"',
  )

  // Disabling persists too, so the reopened pane shows the rule switched off.
  const enabled = rule.getByRole('checkbox', { name: 'Enable Archive newsletters' })
  await expect(enabled).toBeChecked()
  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/labels/rules') && response.request().method() === 'PATCH',
    ),
    enabled.uncheck(),
  ])
  // Reloading before the body lands would abort the store's own read of it.
  await saved.finished()

  await page.reload()
  const reopened = await openRulesSettings(page)
  const savedRule = reopened.locator('.rule-row', { hasText: 'Archive newsletters' })
  await expect(
    savedRule.getByRole('checkbox', { name: 'Enable Archive newsletters' }),
  ).not.toBeChecked()

  await savedRule.getByTitle('Delete Archive newsletters').click()
  await expect(reopened.locator('.rule-row')).toHaveCount(0)
  await expect(
    reopened.locator('.settings-section-hint', { hasText: 'No rules yet' }),
  ).toBeVisible()
})

test('Settings Rules creates a Cookie AI rule from a plain-language prompt', async ({ page }) => {
  await page.goto('/')
  const modal = await openRulesSettings(page)

  await modal.locator('.rule-editor-form > .label-input').fill('Shop receipts')
  await modal.getByLabel('Rule type').selectOption('ai')
  // The prompt replaces the condition rows and their match selector.
  await expect(modal.locator('.rule-condition-row')).toHaveCount(0)
  await expect(modal.getByLabel('Match')).toHaveCount(0)
  await modal.getByLabel('AI prompt').fill('Receipts and order confirmations from online shops')
  await modal.getByLabel('Apply label').selectOption({ label: 'Finance' })
  await modal.getByRole('button', { name: 'Add rule' }).click()

  const rule = modal.locator('.rule-row', { hasText: 'Shop receipts' })
  await expect(rule.locator('.ni-label-pill')).toHaveText('Finance')
  await expect(rule.locator('.rule-row-summary')).toContainText(
    'Cookie AI: "Receipts and order confirmations from online shops"',
  )

  // Editing brings the prompt back into the form rather than empty conditions.
  await rule.getByTitle('Edit Shop receipts').click()
  await expect(modal.getByLabel('Rule type')).toHaveValue('ai')
  await expect(modal.getByLabel('AI prompt')).toHaveValue(
    'Receipts and order confirmations from online shops',
  )
  await modal.getByRole('button', { name: 'Cancel' }).click()

  await page.reload()
  const reopened = await openRulesSettings(page)
  await expect(
    reopened.locator('.rule-row', { hasText: 'Shop receipts' }).locator('.rule-row-summary'),
  ).toContainText('Cookie AI:')
})
