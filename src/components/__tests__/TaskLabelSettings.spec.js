import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TaskLabelSettings from '../TaskLabelSettings.vue'
import { useTaskLabelsStore } from '../../stores/taskLabels'

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useTaskLabelsStore()
  store.labels = [
    { id: 'l1', name: 'home', color: '#1a73e8', taskCount: 3 },
    { id: 'l2', name: 'work', color: '#e5484d', taskCount: 0 },
  ]
  store.isLoaded = true
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TaskLabelSettings', () => {
  it('lists every label with its colour and task count', () => {
    const wrapper = mount(TaskLabelSettings)

    const rows = wrapper.findAll('.task-label-table-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].get('.task-label-pill').text()).toBe('@home')
    expect(rows[0].get('.task-label-pill').attributes('style')).toContain('rgb(26, 115, 232)')
    expect(rows[0].get('.task-label-count').text()).toBe('3 tasks')
    expect(rows[1].get('.task-label-count').text()).toBe('No tasks')
  })

  it('creates a label with the chosen colour and a normalised name', async () => {
    const create = vi.spyOn(store, 'createLabel').mockResolvedValue({ id: 'l3', name: 'calls' })
    const wrapper = mount(TaskLabelSettings)

    await wrapper.get('[aria-label="New label name"]').setValue('@Calls')
    await wrapper.findAll('.label-create-actions .label-color-swatch')[0].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(create).toHaveBeenCalledWith({ name: 'calls', color: '#e5484d' })
    expect(wrapper.get('[aria-label="New label name"]').element.value).toBe('')
  })

  it('keeps Create disabled for a name the server would refuse', async () => {
    const wrapper = mount(TaskLabelSettings)
    await wrapper.get('[aria-label="New label name"]').setValue('two words')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('renames and recolours from the inline edit', async () => {
    const rename = vi.spyOn(store, 'renameLabel').mockResolvedValue({})
    const recolour = vi.spyOn(store, 'recolourLabel').mockResolvedValue({})
    const wrapper = mount(TaskLabelSettings)

    await wrapper.get('[aria-label="Edit home"]').trigger('click')
    await wrapper.get('[aria-label="Edit name for home"]').setValue('House')
    await wrapper.findAll('[aria-label="Colour for home"] .label-color-swatch')[2].trigger('click')
    await wrapper.get('[aria-label="Save home"]').trigger('click')
    await flushPromises()

    expect(rename).toHaveBeenCalledWith('l1', 'house')
    expect(recolour).toHaveBeenCalledWith('l1', '#2f9e44')
    expect(wrapper.find('[aria-label="Edit name for home"]').exists()).toBe(false)
  })

  it('confirms with the task count before deleting a label in use', async () => {
    const remove = vi.spyOn(store, 'deleteLabel').mockResolvedValue(true)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const wrapper = mount(TaskLabelSettings)

    await wrapper.get('[aria-label="Delete label home"]').trigger('click')

    expect(confirm).toHaveBeenCalledWith('Remove @home from 3 tasks and delete it?')
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes an unused label without asking', async () => {
    const remove = vi.spyOn(store, 'deleteLabel').mockResolvedValue(true)
    const confirm = vi.fn()
    vi.stubGlobal('confirm', confirm)
    const wrapper = mount(TaskLabelSettings)

    await wrapper.get('[aria-label="Delete label work"]').trigger('click')

    expect(confirm).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('l2')
  })
})
