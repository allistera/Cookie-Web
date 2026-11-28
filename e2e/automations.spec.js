import { expect, test } from './workerFixtures.js'
import { SEARCH_API_URL } from '../src/lib/apiWorkers.js'

test('Automations opens from the app switcher on the dashboard and reaches each page', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch Cookie app' }).hover()
  await page.getByRole('menuitem', { name: 'Automations' }).click()

  await expect(page).toHaveURL(/\/automations$/)
  // The switcher menu is hover-driven and the pointer is still parked on it,
  // over the sidebar; park the mouse elsewhere so it cannot take the clicks.
  await page.mouse.move(0, 400)
  await expect(page.locator('.logo-suffix')).toHaveText('Automations')
  const sidebar = page.getByRole('complementary', { name: 'Automations sidebar' })
  const title = page.getByTestId('automations-view').getByRole('heading', { level: 1 })
  const dashboard = page.getByTestId('automations-dashboard')
  await expect(title).toHaveText(/^Good (morning|afternoon|evening), Allister\.$/)
  await expect(dashboard.getByRole('status')).toHaveText('No automation runs yet.')
  await expect(dashboard.getByRole('link', { name: /Open ChatGPT/ })).toHaveAttribute(
    'href',
    /^https:\/\/chatgpt\.com\/\?prompt=Every\+Friday/,
  )

  await sidebar.getByRole('link', { name: 'Connections', exact: true }).click()
  await expect(title).toHaveText('Connections')
  await sidebar.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(dashboard).toBeVisible()

  await sidebar.getByRole('link', { name: 'Create Automation' }).click()
  await expect(page).toHaveURL(/\/automations\/new$/)
  await expect(title).toHaveText('Create Automation')
})

test('an automation is created from its template, run now, switched off and deleted', async ({
  page,
}) => {
  // Two overdue tasks for the run to move, and one due later that stays put.
  for (const [content, dueDate] of [
    ['Renew passport', '2026-01-05'],
    ['Call the bank', '2026-02-10'],
    ['Book flights', '2099-01-01'],
  ]) {
    await page.request.post('/__e2e__/tasks-api/task-items', { data: { content, dueDate } })
  }

  await page.goto('/automations/templates')
  const gallery = page.getByTestId('automations-templates')
  await gallery.getByRole('link', { name: /Reschedule Overdue Tasks to Today/ }).click()
  await expect(page).toHaveURL(/\/automations\/new\?job=reschedule_overdue$/)

  const form = page.getByTestId('automations-create')
  await expect(form.getByRole('radio', { name: /Reschedule Overdue Tasks to Today/ })).toBeChecked()
  await form.getByLabel('Time', { exact: true }).fill('06:30')
  await form.getByRole('checkbox', { name: 'Sat' }).uncheck()
  await form.getByRole('checkbox', { name: 'Sun' }).uncheck()
  await expect(form.getByRole('status')).toContainText('Weekdays at 06:30')
  await form.getByRole('button', { name: 'Create automation' }).click()

  await expect(page).toHaveURL(/\/automations$/)
  const dashboard = page.getByTestId('automations-dashboard')
  const row = dashboard.getByTestId('dashboard-automation')
  await expect(row).toContainText('Reschedule Overdue Tasks to Today')
  await expect(row).toContainText('Weekdays at 06:30 · Next run')
  await expect(dashboard.getByRole('status')).toHaveText('No automation runs yet.')

  await row.getByRole('button', { name: /^Run .* now$/ }).click()
  const run = dashboard.getByTestId('dashboard-run')
  await expect(run).toHaveCount(1)
  await expect(run).toContainText('Moved 2 overdue tasks to today.')
  // A second run finds nothing left to move.
  await row.getByRole('button', { name: /^Run .* now$/ }).click()
  await expect(run).toHaveCount(2)
  await expect(run.first()).toContainText('Nothing was overdue.')

  await row.getByRole('checkbox').uncheck()
  await expect(row).toContainText('Switched off')
  // The automation and its activity are still there after a reload.
  await page.reload()
  await expect(row).toContainText('Switched off')
  await expect(run).toHaveCount(2)

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: /^Delete / }).click()
  await expect(row).toHaveCount(0)
  await expect(dashboard.getByText('You have no automations yet.')).toBeVisible()
  await expect(dashboard.getByRole('status')).toHaveText('No automation runs yet.')
})

// The date it is now in a time zone, as YYYY-MM-DD.
const dateIn = (timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const createAutomation = (page, timeZone) =>
  page.request.post('/__e2e__/automations-api/automations', {
    data: {
      handler: 'reschedule_overdue',
      trigger: {
        type: 'schedule',
        time: '00:00',
        days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        timeZone,
      },
    },
  })

test('a run decides what is overdue by the date in the automation’s own time zone', async ({
  page,
}) => {
  // These two zones are 26 hours apart, so the far-east one is always at
  // least a day ahead: whatever the time, one task is due today in the west
  // and already overdue in the east. That is the minute after local midnight
  // for the eastern schedule, held still.
  const WEST = 'Etc/GMT+12'
  const EAST = 'Pacific/Kiritimati'
  await page.request.post('/__e2e__/tasks-api/task-items', {
    data: { content: 'Water the plants', dueDate: dateIn(WEST) },
  })
  await createAutomation(page, WEST)

  await page.goto('/automations')
  const dashboard = page.getByTestId('automations-dashboard')
  const rows = dashboard.getByTestId('dashboard-automation')
  // A schedule kept in another zone names it beside its times.
  await expect(rows).toContainText('Every day at 00:00 · Next run')
  await expect(rows).toContainText(`${WEST} time`)

  await rows.getByRole('button', { name: /^Run .* now$/ }).click()
  const runs = dashboard.getByTestId('dashboard-run')
  await expect(runs.first()).toContainText('Nothing was overdue.')

  await createAutomation(page, EAST)
  await page.reload()
  await expect(rows).toHaveCount(2)
  await rows
    .nth(1)
    .getByRole('button', { name: /^Run .* now$/ })
    .click()
  await expect(runs).toHaveCount(2)
  await expect(runs.first()).toContainText('Moved 1 overdue task to today.')

  const { items } = await (
    await page.request.get(`/__e2e__/tasks-api/task-items?project=today&date=${dateIn(EAST)}`)
  ).json()
  expect(items.map((item) => item.dueDate)).toEqual([dateIn(EAST)])
})

test('a run leaves Todoist tasks alone only while Todoist syncs tasks, and Tasks shows the move', async ({
  page,
}) => {
  const todoist = '/__e2e__/tasks-api/tasks/todoist'
  await page.request.put(todoist, { data: { token: 'fixture-token-1234' } })
  await page.request.post(`${todoist}/sync`)
  // The sync mirrors "Reply to the landlord" into the Inbox; make it overdue.
  const { items } = await (
    await page.request.get('/__e2e__/tasks-api/task-items?project=inbox')
  ).json()
  const mirror = items.find((item) => item.content === 'Reply to the landlord')
  await page.request.patch('/__e2e__/tasks-api/task-items', {
    data: { id: mirror.id, dueDate: '2026-01-05' },
  })
  await createAutomation(
    page,
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  )

  // Open the Inbox first, so Tasks holds the task with its old date.
  await page.goto('/tasks?project=inbox')
  const task = page.locator('.task-row', { hasText: 'Reply to the landlord' })
  await expect(task.locator('.task-due.overdue')).toHaveCount(1)

  // Moving between the apps inside the page keeps what Tasks has loaded.
  const openApp = async (name) => {
    await page.getByRole('button', { name: 'Switch Cookie app' }).hover()
    await page.getByRole('menuitem', { name }).click()
    await page.mouse.move(0, 400)
  }
  await openApp('Automations')
  const dashboard = page.getByTestId('automations-dashboard')
  const runs = dashboard.getByTestId('dashboard-run')
  const runNow = dashboard.getByRole('button', { name: /^Run .* now$/ })
  await runNow.click()
  await expect(runs.first()).toContainText('Nothing was overdue. Left 1 Todoist task as it is.')

  // With task syncing off, Todoist no longer owns the date and the task moves.
  await page.request.put(todoist, { data: { syncTasks: false } })
  await runNow.click()
  await expect(runs).toHaveCount(2)
  await expect(runs.first()).toContainText('Moved 1 overdue task to today.')

  // Back in Tasks, the same list shows the new date rather than the rows it
  // had loaded before the run.
  await openApp('Tasks')
  await expect(task).toBeVisible()
  await expect(task.locator('.task-due.overdue')).toHaveCount(0)
})

const sse = (events) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')

test('Chat is Cookie Assistant on a page: ask, follow up, start again', async ({ page }) => {
  const requests = []
  const answers = [
    [
      {
        type: 'sources',
        sources: [{ index: 'documents', id: 'd1', title: 'Kitchen plan', subtitle: '' }],
      },
      { type: 'token', text: '**City Construction** sent a revised plan.' },
      { type: 'done' },
    ],
    [{ type: 'token', text: 'Last Tuesday.' }, { type: 'done' }],
  ]
  await page.route(`${SEARCH_API_URL}/chat`, (route) => {
    requests.push(route.request().postDataJSON())
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: sse(answers[requests.length - 1]),
    })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations/chat')

  const chat = page.getByRole('region', { name: 'Cookie Assistant' })
  await expect(chat.getByRole('heading', { name: 'What can I help with?' })).toBeVisible()
  const input = chat.getByLabel('Ask Cookie Assistant')
  await expect(input).toBeFocused()
  await expect(chat.getByRole('button', { name: 'Send message' })).toBeDisabled()

  // Shift+Enter is a new line; Enter sends.
  await input.fill('What happened with')
  await input.press('Shift+Enter')
  await input.pressSequentially('the renovation?')
  await input.press('Enter')

  const reply = chat.locator('.assistant-chat-msg.ai').first()
  await expect(reply).toContainText('City Construction sent a revised plan.')
  await expect(reply.locator('strong')).toHaveText('City Construction')
  await expect(reply.getByRole('button', { name: 'Kitchen plan' })).toBeVisible()
  await expect(chat.locator('.assistant-chat-msg.user')).toHaveText(
    'What happened withthe renovation?',
  )
  expect(requests[0].messages).toEqual([
    { role: 'user', content: 'What happened with\nthe renovation?' },
  ])
  // The page is the conversation: the header's assistant drawer stays shut.
  await expect(page.getByRole('dialog', { name: 'Cookie Assistant' })).toBeHidden()
  await expect(chat.getByRole('heading', { name: 'What can I help with?' })).toBeHidden()

  await input.fill('When?')
  await chat.getByRole('button', { name: 'Send message' }).click()
  await expect(chat.locator('.assistant-chat-msg.ai').nth(1)).toHaveText('Last Tuesday.')
  expect(requests[1].messages).toHaveLength(3)

  // The header's drawer shows the same conversation.
  await page.getByRole('button', { name: 'Show AI chat' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Cookie Assistant' }).locator('.chat-msg'),
  ).toHaveCount(4)
  await page.getByRole('button', { name: 'Hide AI chat' }).click()

  await chat.getByRole('button', { name: 'New chat' }).click()
  await expect(chat.getByRole('heading', { name: 'What can I help with?' })).toBeVisible()
  await expect(chat.locator('.assistant-chat-msg')).toHaveCount(0)
  await expect(input).toBeFocused()
})

test('Connections gives the Claude and Codex commands for the MCP server', async ({ page }) => {
  await page.goto('/automations/connections')

  const guide = page.getByTestId('automations-connections')
  await expect(guide.getByRole('heading', { level: 1 })).toHaveText('Connections')
  await expect(guide.getByRole('heading', { level: 2 })).toHaveText([
    'Server details',
    'Claude Code',
    'Claude desktop app and claude.ai',
    'Codex',
    'Check the connection',
    'Send confirmations',
    'If sign-in fails',
  ])

  const claude = guide.getByRole('region', { name: 'Claude Code' })
  await expect(claude.locator('pre')).toHaveText(
    /^claude mcp add --transport http --scope user --client-id \S+ --callback-port 8765 cookie https:\/\/mcp\.infinitywave\.online\/mcp$/,
  )
  const codex = guide.getByRole('region', { name: 'Codex' })
  await expect(codex.locator('pre')).toHaveText([
    'mcp_oauth_callback_port = 8766',
    /^codex mcp add cookie --url https:\/\/mcp\.infinitywave\.online\/mcp --oauth-client-id \S+$/,
    'codex mcp login cookie',
  ])

  await expect(codex.getByRole('button', { name: 'Copy Codex login command' })).toBeVisible()

  // Send confirmations are created here, not in Settings.
  await expect(
    guide
      .getByRole('region', { name: 'Send confirmations' })
      .getByRole('button', { name: 'Create send confirmation' }),
  ).toBeVisible()
})

test('Templates is a gallery of ideas that can be searched and expanded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/automations/templates')

  const gallery = page.getByTestId('automations-templates')
  await expect(gallery.getByRole('heading', { level: 1 })).toHaveText(
    'Find an automation that works for you',
  )
  await expect(gallery.getByRole('heading', { level: 2 })).toHaveText([
    'Staff picks',
    'Push Notifications',
    'Email',
    'Calendar',
    'Tasks',
  ])
  const picks = gallery.getByRole('region', { name: 'Staff picks' })
  await expect(picks.getByRole('link')).toHaveCount(4)

  // See all swaps the sideways row for a grid.
  const row = picks.getByRole('list')
  await expect(row).toHaveCSS('display', 'flex')
  await picks.getByRole('button', { name: 'See all Staff picks' }).click()
  await expect(row).toHaveCSS('display', 'grid')

  // Search narrows every group and drops the empty ones.
  await gallery.getByRole('searchbox', { name: 'Search ideas' }).fill('overdue')
  await expect(gallery.getByRole('heading', { level: 2 })).toHaveText(['Staff picks'])
  await expect(
    gallery.getByRole('link', { name: /Reschedule Overdue Tasks to Today/ }),
  ).toBeVisible()
  await gallery.getByRole('searchbox', { name: 'Search ideas' }).fill('zzzz')
  await expect(gallery.getByRole('status')).toHaveText('No ideas match “zzzz”.')

  // The prompt box leads to Create Automation.
  const send = gallery.getByRole('button', { name: 'Create automation' })
  await expect(send).toBeDisabled()
  await gallery.getByLabel('Describe an automation').fill('Archive old newsletters')
  await send.click()
  await expect(page).toHaveURL(/\/automations\/new$/)
})
