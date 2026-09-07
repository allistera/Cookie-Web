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

// Deterministic AI output; the real endpoint's validation has Worker unit tests.
async function generateDraft(page, modal, changes = {}) {
  await page.route('**/rule-draft', (route) =>
    route.fulfill({
      json: {
        draft: {
          name: 'Generated rule',
          kind: 'conditions',
          prompt: null,
          action: 'apply_label',
          label_id: null,
          match_type: 'all',
          conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
          ...changes,
        },
      },
    }),
  )
  await modal.getByLabel('Describe your filter').fill('Tag invoices Finance')
  await modal.getByRole('button', { name: 'Generate Rule', exact: true }).click()
  await expect(modal.getByLabel('Rule name')).toHaveValue(changes.name || 'Generated rule')
  await expect(modal.locator('.rule-row')).toHaveCount(0)
}

test('Settings Rules creates a tag rule that survives a reload', async ({ page }) => {
  await page.goto('/')
  const modal = await openRulesSettings(page)
  await expect(modal.locator('.settings-section-hint', { hasText: 'No rules yet' })).toBeVisible()
  await expect(modal.getByLabel('Rule type')).toHaveCount(0)
  await expect(modal.getByRole('button', { name: 'Create Rule' })).toHaveCount(0)
  await generateDraft(page, modal, {
    name: 'Zoom invoices',
    conditions: [{ field: 'from', operator: 'equals', value: 'billing@zoom.us' }],
  })

  await modal.locator('.rule-editor-form > .label-input').fill('Zoom receipts')
  const condition = modal.locator('.rule-condition-row').first()
  await condition.locator('select').nth(0).selectOption('from')
  await condition.locator('select').nth(1).selectOption('contains')
  await condition.locator('.label-input').fill('billing@zoom.us')
  await modal.getByLabel('Apply label').selectOption({ label: 'Finance' })
  await modal.getByRole('button', { name: 'Create Rule' }).click()

  const rule = modal.locator('.rule-row', { hasText: 'Zoom receipts' })
  await expect(rule.locator('.ni-label-pill')).toHaveText('Finance')
  await expect(rule.locator('.rule-row-summary')).toContainText(
    'All of: From contains "billing@zoom.us"',
  )
  await expect(page.locator('.toast', { hasText: 'Rule created.' })).toBeVisible()
  // The draft resets so the form is ready for the next rule.
  await expect(modal.getByLabel('Describe your filter')).toHaveValue('')
  await expect(modal.locator('.rule-editor-form')).toHaveCount(0)

  // The rule came back from the API, not just local state.
  await page.reload()
  const reopened = await openRulesSettings(page)
  await expect(reopened.locator('.rule-row', { hasText: 'Zoom receipts' })).toBeVisible()
})

test('A tag rule can be switched to Mark done, disabled, and deleted', async ({ page }) => {
  await page.goto('/')
  const modal = await openRulesSettings(page)
  await generateDraft(page, modal)

  await modal.locator('.rule-editor-form > .label-input').fill('Archive newsletters')
  const first = modal.locator('.rule-condition-row').first()
  await first.locator('select').nth(0).selectOption('body')
  await first.locator('.label-input').fill('unsubscribe')
  await modal.getByLabel('Apply label').selectOption({ label: 'Newsletters' })
  await modal.getByRole('button', { name: 'Create Rule' }).click()

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
  // Wait for persistence, not just the optimistic row update, before toggling.
  await expect(modal.locator('.rule-editor-form')).toHaveCount(0)

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
  await generateDraft(page, modal, {
    name: 'Shop receipts',
    kind: 'ai',
    prompt: 'Online shop receipts',
    conditions: [],
  })

  await modal.locator('.rule-editor-form > .label-input').fill('Shop receipts')
  // The prompt replaces the condition rows and their match selector.
  await expect(modal.locator('.rule-condition-row')).toHaveCount(0)
  await expect(modal.getByLabel('Match')).toHaveCount(0)
  await modal.getByLabel('AI prompt').fill('Receipts and order confirmations from online shops')
  await modal.getByLabel('Apply label').selectOption({ label: 'Finance' })
  await modal.getByRole('button', { name: 'Create Rule' }).click()

  const rule = modal.locator('.rule-row', { hasText: 'Shop receipts' })
  await expect(rule.locator('.ni-label-pill')).toHaveText('Finance')
  await expect(rule.locator('.rule-row-summary')).toContainText(
    'Cookie AI: "Receipts and order confirmations from online shops"',
  )

  // Editing brings the prompt back into the form rather than empty conditions.
  await rule.getByTitle('Edit Shop receipts').click()
  await expect(modal.getByLabel('Rule type')).toHaveCount(0)
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

test('Rule generation can be retried and reviewed on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings/rules')
  const modal = await openRulesSettings(page)
  await page.route('**/rule-draft', (route) =>
    route.fulfill({
      status: 422,
      json: { error: 'Rules cannot forward mail.' },
    }),
  )
  await modal.getByLabel('Describe your filter').fill('Forward all mail')
  await modal.getByRole('button', { name: 'Generate Rule', exact: true }).click()
  await expect(modal.getByRole('alert')).toHaveText('Rules cannot forward mail.')
  await expect(modal.getByLabel('Describe your filter')).toHaveValue('Forward all mail')
  await expect(modal.locator('.rule-row')).toHaveCount(0)
  await generateDraft(page, modal, { action: 'mark_done' })
  await expect(
    modal.getByText('Matching mail will be archived and marked read.', { exact: false }),
  ).toBeVisible()
  await modal.getByRole('button', { name: 'Create Rule' }).scrollIntoViewIfNeeded()
  await expect(modal.getByRole('button', { name: 'Create Rule' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await modal.getByRole('button', { name: 'Back to description' }).click()
  await expect(modal.getByLabel('Describe your filter')).toHaveValue('Tag invoices Finance')
  await expect(modal.locator('.rule-row')).toHaveCount(0)
})
