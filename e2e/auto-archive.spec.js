import { test, expect } from './workerFixtures.js'

test('Auto Archive categories can be independently saved, reloaded and disabled', async ({
  page,
}) => {
  await page.goto('/settings/auto-archive')
  const pane = page.getByTestId('auto-archive-section')
  const marketing = pane.getByRole('checkbox', { name: 'Marketing', exact: true })
  const coldPitches = pane.getByRole('checkbox', { name: 'Cold pitches', exact: true })
  const socialNoise = pane.getByRole('checkbox', { name: 'Social noise', exact: true })
  await expect(marketing).not.toBeChecked()
  await expect(coldPitches).not.toBeChecked()
  await expect(socialNoise).not.toBeChecked()
  await marketing.check()
  await socialNoise.check()
  await pane.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(pane.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await page.reload()
  await expect(marketing).toBeChecked()
  await expect(coldPitches).not.toBeChecked()
  await expect(socialNoise).toBeChecked()
  await marketing.uncheck()
  await pane.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(pane.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await page.reload()
  await expect(marketing).not.toBeChecked()
  await expect(socialNoise).toBeChecked()
})
