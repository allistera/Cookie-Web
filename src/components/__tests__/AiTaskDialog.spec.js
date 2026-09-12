import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AiTaskDialog from '../AiTaskDialog.vue'
import { useTaskItemsStore } from '../../stores/taskItems'

let wrapper
beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  // jsdom does not implement native dialog methods.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  wrapper?.unmount()
  delete HTMLDialogElement.prototype.showModal
  delete HTMLDialogElement.prototype.close
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function openDialog() {
  wrapper = mount(AiTaskDialog, { global: { stubs: { teleport: true } } })
}

describe('AI task hint', () => {
  it('disappears after five seconds and returns when reopened', async () => {
    openDialog()
    await vi.advanceTimersByTimeAsync(4999)
    expect(wrapper.get('#ai-task-status').text()).toContain('Describe a task.')
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.find('#ai-task-status').exists()).toBe(false)
    expect(wrapper.get('input').attributes('aria-describedby')).toBeUndefined()
    wrapper.unmount()
    openDialog()
    expect(wrapper.get('#ai-task-status').text()).toContain('Describe a task.')
  })

  it('keeps creation progress and errors visible after the hint expires', async () => {
    let rejectCreation
    vi.spyOn(useTaskItemsStore(), 'generateItem').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          rejectCreation = reject
        }),
    )
    openDialog()
    await wrapper.get('input').setValue('Plan a trip')
    await wrapper.get('form').trigger('submit')
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.get('#ai-task-status').text()).toContain('Creating your task')
    rejectCreation(new Error('Failed'))
    await flushPromises()
    expect(wrapper.find('#ai-task-status').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not create your task')
  })
})
