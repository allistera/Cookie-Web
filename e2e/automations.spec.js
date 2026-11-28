import { expect, test } from './workerFixtures.js'
import { SEARCH_API_URL } from '../src/lib/apiWorkers.js'

test('Automations opens from the app switcher and shows an empty page per sidebar item', async ({
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
  const title = page.getByTestId('automations-view').getByRole('heading')
  await expect(title).toHaveText('Dashboard')

  for (const name of ['Templates', 'Dashboard']) {
    await sidebar.getByRole('link', { name, exact: true }).click()
    await expect(title).toHaveText(name)
  }

  await sidebar.getByRole('link', { name: 'Create Automation' }).click()
  await expect(page).toHaveURL(/\/automations\/new$/)
  await expect(title).toHaveText('Create Automation')
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
