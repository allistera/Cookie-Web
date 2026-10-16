import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TaskDurationInput from '../TaskDurationInput.vue'

describe('TaskDurationInput', () => {
  it('shows an existing estimate and emits numeric minutes or null', async () => {
    const wrapper = mount(TaskDurationInput, { props: { modelValue: 30 } })
    const input = wrapper.get('input')
    expect(input.element.value).toBe('30')
    await input.setValue('90')
    await input.setValue('')
    expect(wrapper.emitted('update:modelValue')).toEqual([[90], [null]])
  })

  it.each(['0', '-1', '1.5', '1441'])('keeps invalid value %s from being saved', async (value) => {
    const wrapper = mount(TaskDurationInput)
    await wrapper.get('input').setValue(value)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('1 to 1440')
  })

  it('keeps a quick clear while an older save is pending', async () => {
    const wrapper = mount(TaskDurationInput)
    await wrapper.get('input').setValue('45')
    await wrapper.setProps({ saving: true })
    await wrapper.get('input').setValue('')
    await wrapper.setProps({ modelValue: 45 })
    expect(wrapper.get('input').element.value).toBe('')
    expect(wrapper.emitted('update:modelValue')).toEqual([[45], [null]])
    await wrapper.setProps({ modelValue: null, saving: false })
    expect(wrapper.get('input').element.value).toBe('')
  })

  it('shows a new task’s estimate when the bound value changes', async () => {
    const wrapper = mount(TaskDurationInput, { props: { modelValue: 45 } })
    await wrapper.setProps({ modelValue: null })
    expect(wrapper.get('input').element.value).toBe('')
  })
})
