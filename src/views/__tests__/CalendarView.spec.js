import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CalendarView from '../CalendarView.vue'

describe('CalendarView', () => {
  it('shows the calendar sidebar and filters events by calendar', async () => {
    const wrapper = mount(CalendarView)
    const calendarButtons = wrapper.findAll('.calendar-list-item')

    expect(calendarButtons).toHaveLength(5)
    expect(calendarButtons.map((button) => button.text())).toEqual([
      'Work',
      'Personal',
      'Focus time',
      'Birthdays',
      'Holidays',
    ])
    expect(wrapper.find('.day-event').text()).toContain('Standup')

    await calendarButtons[0].trigger('click')
    expect(calendarButtons[0].attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.day-event').exists()).toBe(true)
    expect(wrapper.find('.day-event').text()).toContain('Coffee with Sam')
    expect(wrapper.text()).not.toContain('Standup')

    await calendarButtons[0].trigger('click')
    expect(wrapper.text()).toContain('Standup')
  })

  it('switches between the supplied Day, Week, and Month calendar states', async () => {
    const wrapper = mount(CalendarView)

    expect(wrapper.get('h1').text()).toBe('Friday, July 24, 2026')
    expect(wrapper.find('.day-calendar').exists()).toBe(true)
    expect(wrapper.find('.calendar-insights').exists()).toBe(true)

    await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.get('h1').text()).toBe('Jul 20 – 26, 2026')
    expect(wrapper.find('.week-calendar').exists()).toBe(true)
    expect(wrapper.find('.calendar-insights').exists()).toBe(false)

    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    expect(wrapper.get('h1').text()).toBe('July 2026')
    expect(wrapper.find('.month-calendar').exists()).toBe(true)
    expect(wrapper.findAll('.month-day')).toHaveLength(35)
    expect(wrapper.find('.calendar-insights').exists()).toBe(true)
  })

  it('navigates by the active view period and returns to the reference date', async () => {
    const wrapper = mount(CalendarView)
    const next = wrapper.get('button[aria-label="Next period"]')

    await next.trigger('click')
    expect(wrapper.get('h1').text()).toBe('Saturday, July 25, 2026')
    await wrapper.get('.today-button').trigger('click')
    expect(wrapper.get('h1').text()).toBe('Friday, July 24, 2026')

    await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')
    await next.trigger('click')
    expect(wrapper.get('h1').text()).toBe('Jul 27 – Aug 2, 2026')

    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    await next.trigger('click')
    expect(wrapper.get('h1').text()).toBe('August 2026')
  })

  it('opens the New event dialog and adds a requested event to the selected date', async () => {
    const wrapper = mount(CalendarView, { attachTo: document.body })

    await wrapper.get('.new-event-button').trigger('click')
    const create = wrapper.get('.new-event-create')
    expect(create.attributes('disabled')).toBeDefined()

    await wrapper.get('.new-event-request').setValue('Lunch with Mia')
    expect(wrapper.get('.new-event-create').attributes('disabled')).toBeUndefined()
    await wrapper.get('.new-event-create').trigger('click')

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(wrapper.text()).toContain('Lunch with Mia')
    wrapper.unmount()
  })

  it('dismisses insight cards through their actions', async () => {
    const wrapper = mount(CalendarView)

    await wrapper.get('.primary-small-button').trigger('click')
    expect(wrapper.text()).not.toContain('Scheduling conflict')

    await wrapper.get('.secondary-small-button').trigger('click')
    expect(wrapper.text()).not.toContain('Suggested slot')
    expect(wrapper.text()).toContain('Auto-scheduled')
  })
})
