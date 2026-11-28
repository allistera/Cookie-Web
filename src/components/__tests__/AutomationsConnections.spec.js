import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AutomationsConnections from '../AutomationsConnections.vue'
import McpClientSettings from '../McpClientSettings.vue'

const ENDPOINT = 'https://mcp.infinitywave.online/mcp'
const CLIENT_ID = 'rTBvArPhtT8s9dGwT8mODMphNrngYlHb'
const CLAUDE = `claude mcp add --transport http --scope user --client-id ${CLIENT_ID} --callback-port 8765 cookie ${ENDPOINT}`
const CODEX = `codex mcp add cookie --url ${ENDPOINT} --oauth-client-id ${CLIENT_ID}`

function mountGuide() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  })
  return mount(AutomationsConnections, { global: { plugins: [router] } })
}

const commands = (section) => section.findAll('pre').map((block) => block.text())
const section = (wrapper, id) => wrapper.get(`section[aria-labelledby="${id}"]`)

describe('AutomationsConnections', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('gives the server URL, the client ID and each client’s commands', () => {
    const wrapper = mountGuide()

    const details = section(wrapper, 'connections-server')
    expect(details.findAll('dd code').map((code) => code.text())).toEqual([ENDPOINT, CLIENT_ID])
    expect(commands(section(wrapper, 'connections-claude-code'))).toEqual([CLAUDE])
    expect(commands(section(wrapper, 'connections-codex'))).toEqual([
      'mcp_oauth_callback_port = 8766',
      CODEX,
      'codex mcp login cookie',
    ])
    // The desktop app and claude.ai take a connector in the app, not a command.
    const connector = section(wrapper, 'connections-claude')
    expect(commands(connector)).toEqual([])
    expect(connector.text()).toContain('Add custom connector')
    expect(connector.text()).toContain(CLIENT_ID)
  })

  it('shows the same commands as Settings, MCP clients', () => {
    const settings = mount(McpClientSettings)

    expect(commands(settings)).toEqual([
      CLAUDE,
      'mcp_oauth_callback_port = 8766',
      CODEX,
      'codex mcp login cookie',
    ])
  })

  it('copies a command and says so for a moment', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = mountGuide()
    const button = section(wrapper, 'connections-claude-code').get('.connections-copy')

    expect(button.text()).toContain('Copy')
    await button.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledExactlyOnceWith(CLAUDE)
    expect(button.text()).toContain('Copied')
    // Only the copied command's button changes.
    expect(section(wrapper, 'connections-codex').text()).not.toContain('Copied')

    await vi.advanceTimersByTimeAsync(2000)
    expect(button.text()).not.toContain('Copied')
  })

  it('leaves the button alone when the clipboard refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const wrapper = mountGuide()
    const button = section(wrapper, 'connections-codex').get('.connections-copy')

    await button.trigger('click')
    await flushPromises()

    expect(button.text()).not.toContain('Copied')
  })

  it('links to Settings for send confirmations', () => {
    const link = section(mountGuide(), 'connections-check').get('a')

    expect(link.attributes('href')).toBe('/settings/mcp-clients')
  })
})
