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
  await expect(collegeTourRow).not.toBeVisible({ timeout: 2000 })
  
  // 6. Verify that the counter updated to 4 to-dos
  await expect(counter).toContainText('4 to-dos')
  
  // 7. Verify that the next task (Resale Marketplace Sale) was promoted
  const marketplaceRow = page.locator('#todo-marketplace')
  await expect(marketplaceRow).toBeVisible()
})
