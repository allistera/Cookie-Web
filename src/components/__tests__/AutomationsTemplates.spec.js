import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import AutomationsTemplates from '../AutomationsTemplates.vue'
import { MATERIAL_SYMBOL_NAMES } from '../../lib/iconFont'
import { TEMPLATE_APPS, TEMPLATE_GROUPS, searchTemplateGroups } from '../../lib/automationTemplates'

async function mountGallery() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  })
  await router.push('/automations/templates')
  const wrapper = mount(AutomationsTemplates, { global: { plugins: [router] } })
  return { wrapper, router }
}

const groupTitles = (wrapper) => wrapper.findAll('h2').map((heading) => heading.text())
const cardTitles = (wrapper) =>
  wrapper.findAll('.templates-card-title').map((title) => title.text())

describe('automation templates', () => {
  it('names every template once and only uses apps and icons that exist', () => {
    const templates = TEMPLATE_GROUPS.flatMap((group) => group.templates)
    const ids = templates.map((template) => template.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(TEMPLATE_GROUPS.map((group) => group.id)).size).toBe(TEMPLATE_GROUPS.length)
    for (const template of templates) {
      expect(template.title).not.toBe('')
      expect(template.description).not.toBe('')
      expect(template.apps.length).toBeGreaterThan(0)
      for (const app of template.apps) expect(TEMPLATE_APPS).toHaveProperty(app)
    }
    for (const app of Object.values(TEMPLATE_APPS)) {
      expect(MATERIAL_SYMBOL_NAMES).toContain(app.icon)
    }
  })

  it('searches titles and descriptions for every word and drops empty groups', () => {
    expect(searchTemplateGroups('')).toBe(TEMPLATE_GROUPS)
    expect(searchTemplateGroups('   ')).toBe(TEMPLATE_GROUPS)

    const overdue = searchTemplateGroups('OVERDUE midnight')
    expect(overdue.map((group) => group.id)).toEqual(['staff-picks'])
    expect(overdue[0].templates.map((template) => template.id)).toEqual(['reschedule-overdue'])

    expect(searchTemplateGroups('overdue newsletters')).toEqual([])
  })
})

describe('AutomationsTemplates', () => {
  it('shows each group with its cards, their apps and who they are by', async () => {
    const { wrapper } = await mountGallery()

    expect(wrapper.get('h1').text()).toBe('Find an automation that works for you')
    expect(groupTitles(wrapper)).toEqual(TEMPLATE_GROUPS.map((group) => group.title))
    expect(cardTitles(wrapper)).toEqual(
      TEMPLATE_GROUPS.flatMap((group) => group.templates.map((template) => template.title)),
    )
    const first = wrapper.get('.templates-card')
    expect(first.attributes('href')).toBe('/automations/new')
    // The one idea Cookie can already run opens Create Automation on its job.
    const runnable = wrapper
      .findAll('.templates-card')
      .find((card) => card.text().includes('Reschedule Overdue Tasks to Today'))
    expect(runnable.attributes('href')).toBe('/automations/new?job=reschedule_overdue')
    expect(first.findAll('.templates-app').map((app) => app.attributes('title'))).toEqual([
      'Email',
      'Calendar',
      'Tasks',
    ])
    expect(first.get('.templates-author').text()).toBe('By Cookie')
    // A group without a description shows none.
    expect(wrapper.findAll('.templates-group-head p')).toHaveLength(
      TEMPLATE_GROUPS.filter((group) => group.description).length,
    )
  })

  it('narrows the gallery as the search box is typed in, and says when nothing matches', async () => {
    const { wrapper } = await mountGallery()
    const search = wrapper.get('.templates-search input')

    await search.setValue('newsletter')
    expect(groupTitles(wrapper)).toEqual(['Email'])
    expect(cardTitles(wrapper)).toEqual(['Weekly Newsletter Round-Up'])
    expect(wrapper.find('.templates-empty').exists()).toBe(false)

    await search.setValue('  nothing like this ')
    expect(groupTitles(wrapper)).toEqual([])
    expect(wrapper.get('.templates-empty').text()).toBe('No ideas match “nothing like this”.')
  })

  it('lays one group out as a grid on See all and back again', async () => {
    const { wrapper } = await mountGallery()
    const [first, second] = wrapper.findAll('.templates-group')
    const button = first.get('.templates-see-all')

    expect(button.text()).toContain('See all')
    expect(button.attributes('aria-expanded')).toBe('false')
    await button.trigger('click')

    expect(first.get('.templates-row').classes()).toContain('expanded')
    expect(second.get('.templates-row').classes()).not.toContain('expanded')
    expect(button.text()).toContain('Show less')
    expect(button.attributes('aria-expanded')).toBe('true')

    await button.trigger('click')
    expect(first.get('.templates-row').classes()).not.toContain('expanded')
    // Two cards fit in the row, so that group offers nothing more.
    expect(second.find('.templates-see-all').exists()).toBe(false)
  })

  it('sends a described automation to Create Automation, and nothing when empty', async () => {
    const { wrapper, router } = await mountGallery()
    const form = wrapper.get('.templates-prompt')

    expect(form.get('button').attributes('disabled')).toBeDefined()
    await form.trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/automations/templates')

    await form.get('input').setValue('Archive old newsletters')
    await form.trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/automations/new')
  })
})
