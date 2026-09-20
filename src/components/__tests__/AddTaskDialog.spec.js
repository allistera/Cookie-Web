import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddTaskDialog from '../AddTaskDialog.vue'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useTaskLabelsStore } from '../../stores/taskLabels'

let items
let projects

function mountDialog() {
  return mount(AddTaskDialog, { attachTo: document.body })
}

function parsedTask(overrides = {}) {
  return {
    content: 'Call plumber',
    description: null,
    projectId: 'p1',
    dueDate: '2026-09-11',
    dueTime: '15:00',
    timeZone: 'Europe/London',
    priority: 1,
    recurrence: null,
    labels: ['home'],
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useTaskLabelsStore().isLoaded = true
  items = useTaskItemsStore()
  projects = useProjectsStore()
  projects.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
  projects.isLoaded = true
  vi.spyOn(items, 'notify').mockImplementation(() => {})
})

describe('AddTaskDialog natural-language quick add', () => {
  it('opens on the focused AI textbox and shows the default Inbox destination', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.get('[aria-label="Describe your task"]').element).toBe(document.activeElement)
    expect(wrapper.text()).toContain('Inbox')
    expect(wrapper.text()).toContain('p1–p4')
    wrapper.unmount()
  })

  it('parses and creates all fields in one gesture', async () => {
    const interpret = vi.spyOn(items, 'interpretItem').mockResolvedValue(parsedTask())
    const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't1' })
    const wrapper = mountDialog()

    await wrapper
      .get('[aria-label="Describe your task"]')
      .setValue('Call plumber Friday 3pm p1 #Work @home')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(interpret).toHaveBeenCalledWith('Call plumber Friday 3pm p1 #Work @home')
    expect(create).toHaveBeenCalledWith({
      content: 'Call plumber',
      projectId: 'p1',
      dueDate: '2026-09-11',
      dueTime: '15:00',
      timeZone: 'Europe/London',
      priority: 1,
      labels: ['home'],
    })
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows parsed labels as chips in the full form and sends any added one', async () => {
    vi.spyOn(items, 'interpretItem').mockResolvedValue(parsedTask())
    const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't1' })
    const wrapper = mountDialog()
    await wrapper.get('[aria-label="Describe your task"]').setValue('Call plumber @home')
    await wrapper.get('button.add-task-advanced').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.task-label-chip-text').map((chip) => chip.text())).toEqual(['@home'])
    const input = wrapper.get('.task-label-picker-input')
    await input.setValue('calls')
    await input.trigger('keydown', { key: 'Enter' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(create.mock.calls[0][0].labels).toEqual(['home', 'calls'])
    wrapper.unmount()
  })

  it('parses into the editable full form when Advanced is clicked', async () => {
    vi.spyOn(items, 'interpretItem').mockResolvedValue(
      parsedTask({ recurrence: 'every friday', description: 'Ask about the boiler' }),
    )
    const create = vi.spyOn(items, 'createItem')
    const wrapper = mountDialog()

    await wrapper
      .get('[aria-label="Describe your task"]')
      .setValue('Call plumber Friday 3pm p1 #Work @home')
    await wrapper.get('button.add-task-advanced').trigger('click')
    await flushPromises()

    expect(create).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="Task name"]').element.value).toBe('Call plumber')
    expect(wrapper.get('[aria-label="Description"]').element.value).toBe('Ask about the boiler')
    expect(wrapper.get('[aria-label="Project"]').element.value).toBe('p1')
    expect(wrapper.get('[aria-label="Due date"]').element.value).toBe('2026-09-11')
    expect(wrapper.get('[aria-label="Due time"]').element.value).toBe('15:00')
    expect(wrapper.get('[aria-label="Priority"]').element.value).toBe('1')
    expect(wrapper.findAll('.task-label-chip-text').map((chip) => chip.text())).toEqual(['@home'])
    expect(wrapper.get('.task-repeat input').element.value).toBe('every friday')
    wrapper.unmount()
  })

  it('keeps the raw text editable when interpretation fails on Advanced', async () => {
    vi.spyOn(items, 'interpretItem').mockRejectedValue({ userMessage: 'Try a clearer date' })
    const wrapper = mountDialog()

    await wrapper.get('[aria-label="Describe your task"]').setValue('Call plumber sometime')
    await wrapper.get('button.add-task-advanced').trigger('click')
    await flushPromises()

    expect(wrapper.get('[aria-label="Task name"]').element.value).toBe('Call plumber sometime')
    expect(wrapper.get('[role="alert"]').text()).toContain('Try a clearer date')
    wrapper.unmount()
  })

  it('keeps parsed metadata and asks for a title when the input only has metadata', async () => {
    vi.spyOn(items, 'interpretItem').mockResolvedValue(parsedTask({ content: '' }))
    const create = vi.spyOn(items, 'createItem')
    const wrapper = mountDialog()

    await wrapper.get('[aria-label="Describe your task"]').setValue('Friday 3pm p1 #Work @home')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(create).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="Due time"]').element.value).toBe('15:00')
    expect(wrapper.get('[role="alert"]').text()).toContain('Add a task name')
    wrapper.unmount()
  })

  it('does nothing for empty input', async () => {
    const interpret = vi.spyOn(items, 'interpretItem')
    const create = vi.spyOn(items, 'createItem')
    const wrapper = mountDialog()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(interpret).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('submits once when submitted twice while interpretation is pending', async () => {
    let release
    const interpret = vi
      .spyOn(items, 'interpretItem')
      .mockReturnValue(new Promise((resolve) => (release = resolve)))
    vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't1' })
    const wrapper = mountDialog()

    await wrapper.get('[aria-label="Describe your task"]').setValue('Buy milk Friday')
    wrapper.get('form').trigger('submit')
    wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(interpret).toHaveBeenCalledTimes(1)
    release(parsedTask({ content: 'Buy milk' }))
    await flushPromises()
    wrapper.unmount()
  })

  it('closes on Escape and a backdrop click, but not a click inside', async () => {
    const escapeWrapper = mountDialog()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(escapeWrapper.emitted('close')).toBeTruthy()
    escapeWrapper.unmount()

    const clickWrapper = mountDialog()
    await clickWrapper.get('.add-task-dialog').trigger('click')
    expect(clickWrapper.emitted('close')).toBeFalsy()
    await clickWrapper.get('.add-task-dialog-backdrop').trigger('click')
    expect(clickWrapper.emitted('close')).toBeTruthy()
    clickWrapper.unmount()
  })
})
