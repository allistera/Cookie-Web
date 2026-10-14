import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TaskFilterEditor from '../TaskFilterEditor.vue'
import { useProjectsStore } from '../../stores/projects'
import { useTaskFiltersStore } from '../../stores/taskFilters'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useTaskLabelsStore } from '../../stores/taskLabels'

const FILTER = {
  id: 'f1',
  name: 'Urgent',
  match: 'all',
  rules: [{ field: 'priority', value: 1, negate: false }],
}

let router
let store

function mountEditor() {
  return mount(TaskFilterEditor, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks?project=inbox')
  await router.isReady()
  setActivePinia(createPinia())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ projects: [], labels: [] }) })),
  )
  const projects = useProjectsStore()
  projects.projects = [
    { id: 'p1', parentId: null, name: 'Work' },
    { id: 'p2', parentId: 'p1', name: 'API' },
  ]
  projects.isLoaded = true
  const labels = useTaskLabelsStore()
  labels.labels = [{ id: 'l1', name: 'home', color: '#1a73e8' }]
  labels.isLoaded = true
  store = useTaskFiltersStore()
  store.isLoaded = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TaskFilterEditor', () => {
  it('starts a new filter with one due rule and keeps Save off until it is named', async () => {
    store.openEditor()
    const wrapper = mountEditor()
    await flushPromises()

    expect(wrapper.get('dialog').attributes('aria-label')).toBe('New filter')
    expect(wrapper.get('[aria-label="Rule 1 field"]').element.value).toBe('due')
    expect(wrapper.get('[aria-label="Rule 1 due"]').element.value).toBe('today')
    expect(wrapper.get('[aria-label="Remove rule 1"]').attributes('disabled')).toBeDefined()
    const submit = wrapper.get('button[type="submit"]')
    expect(submit.text()).toBe('Save filter')
    expect(submit.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.task-filter-editor-hint').text()).toBe('Give the filter a name.')

    await wrapper.get('[aria-label="Filter name"]').setValue('Today')
    expect(submit.attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.task-filter-editor-hint').text()).toBe('')
  })

  it('adds a rule, gives a changed field a legal value, and removes it again', async () => {
    store.openEditor()
    const wrapper = mountEditor()
    await flushPromises()

    await wrapper.get('.task-filter-add-rule').trigger('click')
    expect(wrapper.findAll('.task-filter-rule')).toHaveLength(2)

    await wrapper.get('[aria-label="Rule 2 field"]').setValue('project')
    expect(store.editor.rules[1]).toEqual({ field: 'project', value: 'inbox', negate: false })
    const projectOptions = wrapper.get('[aria-label="Rule 2 project"]').findAll('option')
    expect(projectOptions.map((option) => option.text())).toEqual(['Inbox', 'Work', 'API'])
    // A nested project is indented under its parent, as in the sidebar.
    expect(projectOptions[2].element.textContent).toContain('\u2003API')

    await wrapper.get('[aria-label="Rule 2 field"]').setValue('label')
    expect(store.editor.rules[1]).toEqual({ field: 'label', value: 'home', negate: false })
    await wrapper.get('[aria-label="Rule 2 includes or excludes"]').setValue('true')
    expect(store.editor.rules[1].negate).toBe(true)

    await wrapper.get('[aria-label="Remove rule 2"]').trigger('click')
    expect(wrapper.findAll('.task-filter-rule')).toHaveLength(1)
  })

  it('fills a label rule chosen before the labels arrived', async () => {
    const labels = useTaskLabelsStore()
    labels.labels = []
    store.openEditor()
    const wrapper = mountEditor()
    await flushPromises()

    await wrapper.get('[aria-label="Filter name"]').setValue('Home')
    await wrapper.get('[aria-label="Rule 1 field"]').setValue('label')
    expect(store.editor.rules[0].value).toBe('')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    labels.labels = [{ id: 'l1', name: 'home', color: '#1a73e8' }]
    await flushPromises()

    expect(store.editor.rules[0].value).toBe('home')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it('saves a new filter and opens it', async () => {
    store.openEditor()
    const create = vi.spyOn(store, 'createFilter').mockResolvedValue(FILTER)
    const wrapper = mountEditor()
    await flushPromises()

    await wrapper.get('[aria-label="Filter name"]').setValue('Urgent')
    await wrapper.get('[aria-label="Rule 1 field"]').setValue('priority')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Urgent',
        match: 'all',
        rules: [{ field: 'priority', value: 1, negate: false }],
      }),
    )
    expect(store.editor).toBeNull()
    expect(router.currentRoute.value.query.project).toBe('filter:f1')
  })

  it('saves an edited filter and refetches its list when it is on screen', async () => {
    await router.push('/tasks?project=filter:f1')
    store.filters = [FILTER]
    store.openEditor({ filter: FILTER })
    const update = vi.spyOn(store, 'updateFilter').mockResolvedValue({ ...FILTER, match: 'any' })
    const load = vi.spyOn(useTaskItemsStore(), 'loadItems').mockResolvedValue(undefined)
    const wrapper = mountEditor()
    await flushPromises()

    expect(wrapper.get('dialog').attributes('aria-label')).toBe('Edit filter')
    expect(wrapper.get('[aria-label="Filter name"]').element.value).toBe('Urgent')
    await wrapper.get('[aria-label="Match"]').setValue('any')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('f1', expect.objectContaining({ match: 'any' }), {
      name: 'Urgent',
      match: 'all',
      rules: FILTER.rules,
    })
    expect(load).toHaveBeenCalledWith('filter:f1', { force: true })
    expect(store.editor).toBeNull()
  })

  it('stays open and shows why when the save is refused', async () => {
    store.openEditor({ filter: FILTER })
    vi.spyOn(store, 'updateFilter').mockImplementation(async () => {
      store.error = 'Saved-filter names must be unique.'
      return null
    })
    const wrapper = mountEditor()
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(store.editor).not.toBeNull()
    expect(wrapper.get('[role="alert"]').text()).toBe('Saved-filter names must be unique.')
  })

  it('closes on Cancel and on Escape without saving', async () => {
    store.openEditor()
    const wrapper = mountEditor()
    await flushPromises()

    await wrapper.get('.task-filter-cancel').trigger('click')
    expect(store.editor).toBeNull()

    store.openEditor()
    await flushPromises()
    await wrapper.get('dialog').trigger('cancel')
    expect(store.editor).toBeNull()
  })
})
