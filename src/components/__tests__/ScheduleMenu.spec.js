import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import ScheduleMenu from '../ScheduleMenu.vue'
import { scheduleChoices } from '../../utils/schedule'

// Fixed "now" so the presets and the custom-time minimum are deterministic.
const NOW = new Date(2026, 6, 24, 10, 0, 0)

function mountMenu(choices = scheduleChoices(NOW)) {
  return mount(ScheduleMenu, { props: { choices } })
}

describe('ScheduleMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists every preset with its date detail', () => {
    const wrapper = mountMenu()
    const items = wrapper.findAll('button[role="menuitem"]')

    // The four presets plus the "Pick date & time" toggle.
    expect(items).toHaveLength(5)
    expect(items[0].text()).toContain('Later today')
    expect(items[1].text()).toContain('Tomorrow')
    expect(items[1].text()).toContain('Sat 25 Jul')
    expect(items[4].text()).toContain('Pick date & time')
  })

  it('emits the chosen preset unchanged', async () => {
    const choices = scheduleChoices(NOW)
    const wrapper = mountMenu(choices)

    await wrapper.findAll('button[role="menuitem"]')[1].trigger('click')

    expect(wrapper.emitted('select')).toEqual([[choices[1]]])
  })

  it('optionally exposes a clear action and custom form label', async () => {
    const wrapper = mount(ScheduleMenu, {
      props: {
        choices: scheduleChoices(NOW),
        clearLabel: 'Clear reminder',
        customLabel: 'Custom follow-up time',
      },
    })

    const items = wrapper.findAll('button[role="menuitem"]')
    expect(items).toHaveLength(6)
    await items[4].trigger('click')
    expect(wrapper.emitted('clear')).toEqual([[]])

    await items[5].trigger('click')
    expect(wrapper.get('form').attributes('aria-label')).toBe('Custom follow-up time')
  })

  it('keeps the custom form hidden until the picker is opened', async () => {
    const wrapper = mountMenu()
    expect(wrapper.find('.ni-schedule-custom').exists()).toBe(false)

    await wrapper.findAll('button[role="menuitem"]')[4].trigger('click')

    expect(wrapper.find('.ni-schedule-custom').exists()).toBe(true)
    // The input cannot offer a time that has already passed.
    expect(wrapper.get('input[type="datetime-local"]').attributes('min')).toBe('2026-07-24T10:01')
  })

  it('emits a labelled custom choice on submit', async () => {
    const wrapper = mountMenu()
    await wrapper.findAll('button[role="menuitem"]')[4].trigger('click')
    await wrapper.get('input[type="datetime-local"]').setValue('2026-08-03T14:30')

    await wrapper.get('form.ni-schedule-custom').trigger('submit')

    const [[choice]] = wrapper.emitted('select')
    expect(choice.id).toBe('custom')
    expect(choice.date).toEqual(new Date(2026, 7, 3, 14, 30))
    expect(choice.label).toContain('3 Aug')
  })

  it('refuses a custom time in the past', async () => {
    const wrapper = mountMenu()
    await wrapper.findAll('button[role="menuitem"]')[4].trigger('click')
    await wrapper.get('input[type="datetime-local"]').setValue('2020-01-01T09:00')

    expect(wrapper.get('.ni-schedule-custom-submit').attributes('disabled')).toBeDefined()

    await wrapper.get('form.ni-schedule-custom').trigger('submit')

    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
