import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TasksView from '../TasksView.vue'
import { useProjectsStore } from '../../stores/projects'

let router

function mountView() {
  return mount(TasksView, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks?project=p2')
  await router.isReady()
  setActivePinia(createPinia())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [], projects: [] }) })),
  )
  const projects = useProjectsStore()
  projects.projects = [
    { id: 'p1', parentId: null, name: 'Technical Projects', description: null },
    { id: 'p2', parentId: 'p1', name: 'Githup', description: null },
  ]
  projects.isLoaded = true
})

describe('TasksView', () => {
  it('shows the ancestor chain and the project name', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('My Projects')
    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('Technical Projects')
    expect(wrapper.get('.tasks-title').text()).toBe('Githup')
  })

  it('offers the description placeholder until one is written', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('.tasks-description').text()).toBe('Add a description')
  })

  // Inbox is a rule, not a project row, so it has no ancestors to show.
  it('titles the Inbox without a breadcrumb chain', async () => {
    await router.push('/tasks?project=inbox')
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-title').text()).toBe('Inbox')
    expect(wrapper.get('.tasks-breadcrumb').text()).not.toContain('Technical Projects')
  })
})
