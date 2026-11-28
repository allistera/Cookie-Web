import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import AutomationsSidebar from '../AutomationsSidebar.vue'
import { useAutomationsStore } from '../../stores/automations'
import AutomationsView from '../../views/AutomationsView.vue'

// The sidebar beside the view it drives, as App.vue lays them out.
const Shell = {
  components: { AutomationsSidebar },
  template: '<div><AutomationsSidebar /><router-view /></div>',
}

// Each page is a lazy chunk, so a navigation needs its import to land.
async function settle() {
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
}

async function mountAt(path) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/automations/:section?', name: 'automations', component: AutomationsView }],
  })
  await router.push(path)
  const pinia = createPinia()
  // Dashboard reads the automations when it opens; there is no Worker here.
  vi.spyOn(useAutomationsStore(pinia), 'load').mockResolvedValue(true)
  const wrapper = mount(Shell, {
    global: {
      plugins: [router, pinia],
      provide: { [AUTH0_INJECTION_KEY]: { user: ref({ name: 'Allister' }) } },
    },
  })
  await settle()
  return wrapper
}

const heading = (wrapper) => wrapper.get('[data-testid="automations-view"] h1').text()
const onDashboard = (wrapper) => wrapper.find('[data-testid="automations-dashboard"]').exists()
const activeItems = (wrapper) => wrapper.findAll('.nav-item.active').map((item) => item.text())

describe('Automations', () => {
  it('lists Create Automation and the four pages, opening on Dashboard', async () => {
    const wrapper = await mountAt('/automations')

    expect(wrapper.get('.compose-btn').text()).toContain('Create Automation')
    expect(wrapper.findAll('.nav-text').map((item) => item.text())).toEqual([
      'Dashboard',
      'Connections',
      'Templates',
      'Chat',
    ])
    expect(onDashboard(wrapper)).toBe(true)
    expect(heading(wrapper)).toMatch(/^Good (morning|afternoon|evening), Allister\.$/)
    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Dashboard')])
  })

  it('opens the dashboard from Dashboard', async () => {
    const wrapper = await mountAt('/automations/new')
    const link = wrapper.findAll('.nav-item').find((item) => item.text().endsWith('Dashboard'))

    expect(link.attributes('href')).toBe('/automations')
    await link.trigger('click')
    await settle()

    expect(onDashboard(wrapper)).toBe(true)
    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Dashboard')])
  })

  it('opens the gallery of ideas from Templates', async () => {
    const wrapper = await mountAt('/automations')

    await wrapper
      .findAll('.nav-item')
      .find((item) => item.text().endsWith('Templates'))
      .trigger('click')
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Templates')])
    expect(wrapper.get('[data-testid="automations-templates"] h1').text()).toBe(
      'Find an automation that works for you',
    )
  })

  it('opens the MCP setup guide from Connections', async () => {
    const wrapper = await mountAt('/automations')

    await wrapper
      .findAll('.nav-item')
      .find((item) => item.text().endsWith('Connections'))
      .trigger('click')
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Connections')])
    expect(wrapper.get('[data-testid="automations-connections"] h1').text()).toBe('Connections')
  })

  it('opens Cookie Assistant from Chat', async () => {
    const wrapper = await mountAt('/automations')

    await wrapper
      .findAll('.nav-item')
      .find((item) => item.text().endsWith('Chat'))
      .trigger('click')
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Chat')])
    expect(wrapper.get('[aria-label="Cookie Assistant"] h1').text()).toBe('What can I help with?')
  })

  it('opens the Create Automation form from the button', async () => {
    const wrapper = await mountAt('/automations')

    await wrapper.get('.compose-btn').trigger('click')
    await settle()

    expect(heading(wrapper)).toBe('Create Automation')
    expect(wrapper.find('[data-testid="automations-create"]').exists()).toBe(true)
    expect(onDashboard(wrapper)).toBe(false)
    expect(activeItems(wrapper)).toEqual([])
  })

  it('shows Dashboard for a page that does not exist', async () => {
    const wrapper = await mountAt('/automations/nonsense')

    expect(onDashboard(wrapper)).toBe(true)
  })
})
