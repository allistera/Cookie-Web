import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import TaskProjectPicker from '../TaskProjectPicker.vue'
import { useProjectsStore } from '../../stores/projects'

const PROJECTS = [
  { id: 'work', parentId: null, name: 'Work', description: null },
  { id: 'api', parentId: 'work', name: 'Public API', description: null },
  { id: 'home', parentId: null, name: 'Home', description: null },
]

function mountPicker(props = {}, options = {}) {
  return mount(TaskProjectPicker, {
    props: { modelValue: null, ownerName: 'Allister A.', ...props },
    ...options,
  })
}
async function open(wrapper) {
  await wrapper.get('.task-panel-project').trigger('click')
  await flushPromises()
}
function names(wrapper) {
  return wrapper.findAll('.task-project-option-name').map((node) => node.text())
}
function option(wrapper, name) {
  return wrapper
    .findAll('.task-project-option')
    .find((node) => node.get('.task-project-option-name').text() === name)
}

beforeEach(() => {
  setActivePinia(createPinia())
  useProjectsStore().projects = PROJECTS.map((row) => ({ ...row }))
})

describe('TaskProjectPicker', () => {
  it('names the current project on the chip, or the Inbox', () => {
    expect(mountPicker().get('.task-panel-project').text()).toContain('Inbox')
    expect(mountPicker({ modelValue: 'api' }).get('.task-panel-project').text()).toContain(
      'Public API',
    )
    expect(
      mountPicker({ modelValue: 'api' }).get('.task-panel-project').attributes('aria-label'),
    ).toBe('Project: Public API')
  })

  it('drops a search box, the Inbox and every project at its depth', async () => {
    const wrapper = mountPicker({ modelValue: 'api' })
    expect(wrapper.find('.task-project-menu').exists()).toBe(false)

    await open(wrapper)

    expect(wrapper.get('.task-panel-project').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.task-project-search').attributes('placeholder')).toBe(
      'Type a project name',
    )
    expect(names(wrapper)).toEqual(['Inbox', 'Home', 'Work', 'Public API'])
    expect(option(wrapper, 'Public API').attributes('style')).toContain('--depth: 1')
    expect(option(wrapper, 'Work').attributes('style')).toContain('--depth: 0')
    // The current project is marked, and is where the keyboard starts.
    expect(option(wrapper, 'Public API').attributes('aria-selected')).toBe('true')
    expect(option(wrapper, 'Public API').find('.task-project-check').exists()).toBe(true)
    expect(option(wrapper, 'Public API').classes()).toContain('active')
    expect(option(wrapper, 'Inbox').attributes('aria-selected')).toBe('false')
    expect(wrapper.get('.task-project-heading').text()).toContain('My Projects')
    expect(wrapper.get('.task-project-avatar').text()).toBe('A')
  })

  it('chooses a project on click and the Inbox as null', async () => {
    const wrapper = mountPicker()
    await open(wrapper)
    await option(wrapper, 'Home').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['home']])
    expect(wrapper.find('.task-project-menu').exists()).toBe(false)

    await wrapper.setProps({ modelValue: 'home' })
    await open(wrapper)
    await option(wrapper, 'Inbox').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['home'], [null]])
  })

  it('does not re-emit the project the task is already in', async () => {
    const wrapper = mountPicker({ modelValue: 'home' })
    await open(wrapper)
    await option(wrapper, 'Home').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('.task-project-menu').exists()).toBe(false)
  })

  it('filters by what is typed, flattened, and Enter takes the first match', async () => {
    const wrapper = mountPicker()
    await open(wrapper)

    await wrapper.get('.task-project-search').setValue('api')
    expect(names(wrapper)).toEqual(['Public API'])
    expect(option(wrapper, 'Public API').attributes('style')).toContain('--depth: 0')
    expect(wrapper.find('.task-project-heading').exists()).toBe(true)

    await wrapper.get('.task-project-search').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['api']])

    await open(wrapper)
    await wrapper.get('.task-project-search').setValue('zzz')
    expect(names(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('No matching projects.')
    await wrapper.get('.task-project-search').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('moves the active row with the arrow keys, wrapping at the ends', async () => {
    const wrapper = mountPicker()
    await open(wrapper)
    const search = wrapper.get('.task-project-search')
    expect(search.attributes('aria-activedescendant')).toBe('task-project-option-inbox')

    await search.trigger('keydown', { key: 'ArrowDown' })
    expect(search.attributes('aria-activedescendant')).toBe('task-project-option-home')
    await search.trigger('keydown', { key: 'ArrowUp' })
    await search.trigger('keydown', { key: 'ArrowUp' })
    expect(search.attributes('aria-activedescendant')).toBe('task-project-option-api')
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['api']])
  })

  it('closes on Escape without letting the panel see it, and on focus leaving', async () => {
    const wrapper = mountPicker({}, { attachTo: document.body })
    await open(wrapper)
    expect(document.activeElement).toBe(wrapper.get('.task-project-search').element)

    const seen = []
    const spy = () => seen.push('escape')
    document.addEventListener('keydown', spy)
    await wrapper.get('.task-project-search').trigger('keydown', { key: 'Escape' })
    document.removeEventListener('keydown', spy)
    expect(seen).toEqual([])
    expect(wrapper.find('.task-project-menu').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.task-panel-project').element)

    await open(wrapper)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    await wrapper.get('.task-project-search').trigger('focusout', { relatedTarget: outside })
    expect(wrapper.find('.task-project-menu').exists()).toBe(false)
    outside.remove()
    wrapper.unmount()
  })

  it('opens from the outside with the search focused', async () => {
    const wrapper = mountPicker({}, { attachTo: document.body })
    await wrapper.vm.open()
    await flushPromises()

    expect(wrapper.find('.task-project-menu').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('.task-project-search').element)
    wrapper.unmount()
  })
})
