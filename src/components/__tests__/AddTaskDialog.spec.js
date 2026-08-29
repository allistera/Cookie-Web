import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddTaskDialog from '../AddTaskDialog.vue'
import { useTaskItemsStore } from '../../stores/taskItems'

let items

function mountDialog() {
  return mount(AddTaskDialog, { attachTo: document.body })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ item: {} }) })),
  )
  items = useTaskItemsStore()
  vi.spyOn(items, 'notify').mockImplementation(() => {})
})

describe('AddTaskDialog', () => {
  it('focuses the title field on open', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('.add-task-dialog-input').element)
    wrapper.unmount()
  })

  // The dialog says where the task lands, so nobody has to guess.
  it('says the task goes to the Inbox', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('Inbox')
    wrapper.unmount()
  })

  it('creates the task in the Inbox and closes', async () => {
    const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't1' })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.get('.add-task-dialog-input').setValue('Buy milk')
    await wrapper.get('.add-task-dialog-form').trigger('submit')
    await flushPromises()

    expect(create).toHaveBeenCalledWith({ content: 'Buy milk', projectId: null })
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('trims the title before sending it', async () => {
    const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't1' })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.get('.add-task-dialog-input').setValue('   Buy milk   ')
    await wrapper.get('.add-task-dialog-form').trigger('submit')
    await flushPromises()

    expect(create).toHaveBeenCalledWith({ content: 'Buy milk', projectId: null })
    wrapper.unmount()
  })

  it('does nothing on an empty title', async () => {
    const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't1' })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.get('.add-task-dialog-form').trigger('submit')
    await flushPromises()

    expect(create).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeFalsy()
    wrapper.unmount()
  })

  // A failed create keeps the words the person typed rather than binning them.
  it('stays open with the title intact when the create fails', async () => {
    vi.spyOn(items, 'createItem').mockResolvedValue(null)
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.get('.add-task-dialog-input').setValue('Buy milk')
    await wrapper.get('.add-task-dialog-form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('close')).toBeFalsy()
    expect(wrapper.get('.add-task-dialog-input').element.value).toBe('Buy milk')
    wrapper.unmount()
  })

  // Enter would otherwise submit a second time while the first is in flight.
  it('submits once when submitted twice quickly', async () => {
    let release
    const create = vi
      .spyOn(items, 'createItem')
      .mockReturnValue(new Promise((resolve) => (release = resolve)))
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.get('.add-task-dialog-input').setValue('Buy milk')
    wrapper.get('.add-task-dialog-form').trigger('submit')
    wrapper.get('.add-task-dialog-form').trigger('submit')
    await flushPromises()

    expect(create).toHaveBeenCalledTimes(1)
    release({ id: 't1' })
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('closes on a backdrop click but not on a click inside', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.get('.add-task-dialog').trigger('click')
    expect(wrapper.emitted('close')).toBeFalsy()

    await wrapper.get('.add-task-dialog-backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })
})
