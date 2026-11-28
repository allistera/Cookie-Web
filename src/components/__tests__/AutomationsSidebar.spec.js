import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import AutomationsSidebar from '../AutomationsSidebar.vue'
import AutomationsView from '../../views/AutomationsView.vue'

// The sidebar beside the view it drives, as App.vue lays them out.
const Shell = {
  components: { AutomationsSidebar },
  template: '<div><AutomationsSidebar /><router-view /></div>',
}

async function mountAt(path) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/automations/:section?', name: 'automations', component: AutomationsView }],
  })
  await router.push(path)
  const wrapper = mount(Shell, { global: { plugins: [router, createPinia()] } })
  await flushPromises()
  return wrapper
}

const heading = (wrapper) => wrapper.get('[data-testid="automations-view"] h1').text()
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
    expect(heading(wrapper)).toBe('Dashboard')
    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Dashboard')])
  })

  it.each([
    ['Templates', '/automations/templates'],
    ['Dashboard', '/automations'],
  ])('opens an empty %s page from the sidebar', async (label, href) => {
    const wrapper = await mountAt('/automations/new')
    const link = wrapper.findAll('.nav-item').find((item) => item.text().endsWith(label))

    expect(link.attributes('href')).toBe(href)
    await link.trigger('click')
    await flushPromises()

    expect(heading(wrapper)).toBe(label)
    expect(activeItems(wrapper)).toEqual([expect.stringContaining(label)])
    expect(wrapper.get('.automations-page').element.children).toHaveLength(1)
  })

  it('opens the MCP setup guide, not an empty page, from Connections', async () => {
    const wrapper = await mountAt('/automations')

    await wrapper
      .findAll('.nav-item')
      .find((item) => item.text().endsWith('Connections'))
      .trigger('click')
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Connections')])
    expect(wrapper.find('.automations-page').exists()).toBe(false)
    expect(wrapper.get('[data-testid="automations-connections"] h1').text()).toBe('Connections')
  })

  it('opens Cookie Assistant, not an empty page, from Chat', async () => {
    const wrapper = await mountAt('/automations')

    await wrapper
      .findAll('.nav-item')
      .find((item) => item.text().endsWith('Chat'))
      .trigger('click')
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(activeItems(wrapper)).toEqual([expect.stringContaining('Chat')])
    expect(wrapper.find('.automations-page').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Cookie Assistant"] h1').text()).toBe('What can I help with?')
  })

  it('opens an empty Create Automation page from the button', async () => {
    const wrapper = await mountAt('/automations')

    await wrapper.get('.compose-btn').trigger('click')
    await flushPromises()

    expect(heading(wrapper)).toBe('Create Automation')
    expect(activeItems(wrapper)).toEqual([])
  })

  it('shows Dashboard for a page that does not exist', async () => {
    const wrapper = await mountAt('/automations/nonsense')

    expect(heading(wrapper)).toBe('Dashboard')
  })
})
