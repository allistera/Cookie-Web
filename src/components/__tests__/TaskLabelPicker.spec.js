import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import TaskLabelPicker from '../TaskLabelPicker.vue'
import { useTaskLabelsStore } from '../../stores/taskLabels'

function mountPicker(modelValue = [], props = {}) {
  return mount(TaskLabelPicker, { props: { modelValue, ...props } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  const labels = useTaskLabelsStore()
  labels.labels = [
    { id: 'l1', name: 'calls', color: '#e5484d', taskCount: 1 },
    { id: 'l2', name: 'home', color: '#1a73e8', taskCount: 2 },
    { id: 'l3', name: 'house', color: '#2f9e44', taskCount: 0 },
  ]
  labels.isLoaded = true
})

describe('TaskLabelPicker', () => {
  it('renders the selected labels as coloured chips', () => {
    const wrapper = mountPicker(['home', 'unknown'])

    const chips = wrapper.findAll('.task-label-chip')
    expect(wrapper.findAll('.task-label-chip-text').map((chip) => chip.text())).toEqual([
      '@home',
      '@unknown',
    ])
    expect(chips[0].attributes('style')).toContain('color: rgb(26, 115, 232)')
    // A name with no row falls back to the default grey.
    expect(chips[1].attributes('style')).toContain('color: rgb(100, 116, 139)')
  })

  it('suggests unselected labels matching the typed prefix', async () => {
    const wrapper = mountPicker(['home'])

    const input = wrapper.get('.task-label-picker-input')
    await input.trigger('focus')
    await input.setValue('ho')

    expect(wrapper.findAll('.task-label-suggestion').map((s) => s.text())).toEqual(['@house'])
  })

  it('adds a suggestion on click and clears the input', async () => {
    const wrapper = mountPicker(['home'])
    const input = wrapper.get('.task-label-picker-input')
    await input.trigger('focus')
    await input.setValue('c')

    await wrapper.get('.task-label-suggestion').trigger('mousedown')
    await wrapper.get('.task-label-suggestion').trigger('click')

    expect(wrapper.emitted('update:modelValue')[0]).toEqual([['home', 'calls']])
    expect(input.element.value).toBe('')
  })

  it('adds a normalised new name on Enter', async () => {
    const wrapper = mountPicker([])
    const input = wrapper.get('.task-label-picker-input')
    await input.setValue('@Errands')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')[0]).toEqual([['errands']])
  })

  it('ignores Enter on a name the server would refuse or that is already selected', async () => {
    const wrapper = mountPicker(['home'])
    const input = wrapper.get('.task-label-picker-input')
    await input.setValue('two words')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('home')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('removes the last chip on Backspace in an empty input, and any chip by its button', async () => {
    const wrapper = mountPicker(['home', 'calls'])
    await wrapper.get('.task-label-picker-input').trigger('keydown', { key: 'Backspace' })
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([['home']])

    await wrapper.get('[aria-label="Remove home"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')[1]).toEqual([['calls']])
  })

  it('disables the input and remove buttons when disabled', () => {
    const wrapper = mountPicker(['home'], { disabled: true })
    expect(wrapper.get('.task-label-picker-input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.task-label-chip-remove').attributes('disabled')).toBeDefined()
  })
})
