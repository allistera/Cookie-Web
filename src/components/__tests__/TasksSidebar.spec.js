import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TasksSidebar from '../TasksSidebar.vue'

let router

function mountSidebar() {
  return mount(TasksSidebar, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks')
  await router.isReady()
  setActivePinia(createPinia())
})

describe('TasksSidebar', () => {
  it('offers Add Task and an Inbox above the projects section', () => {
    const wrapper = mountSidebar()

    expect(wrapper.get('.compose-btn').text()).toContain('Add Task')
    const inbox = wrapper.get('.tasks-views-nav .nav-item')
    expect(inbox.text()).toContain('Inbox')
    expect(inbox.attributes('href')).toBe('/tasks?project=inbox')
    expect(wrapper.get('.sb-section-label').text()).toBe('My Projects')
  })

  // Inbox is the no-project bucket, so it must never appear as a project row
  // that could be renamed or deleted alongside the real ones.
  it('keeps Inbox out of the projects list', () => {
    const wrapper = mountSidebar()

    expect(wrapper.findAll('.tasks-projects-nav .nav-item')).toHaveLength(0)
    expect(wrapper.get('.tasks-projects-empty').text()).toBe('No projects yet')
  })

  it('marks Inbox active only when the route selects it', async () => {
    const wrapper = mountSidebar()
    expect(wrapper.get('.tasks-views-nav .nav-item').classes()).not.toContain('active')

    await router.push('/tasks?project=inbox')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.tasks-views-nav .nav-item').classes()).toContain('active')
  })
})
