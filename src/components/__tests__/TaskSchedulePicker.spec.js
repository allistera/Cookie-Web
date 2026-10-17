import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TaskSchedulePicker from '../TaskSchedulePicker.vue'

// A Friday, so the shortcuts have known answers.
const TODAY = new Date(2026, 9, 16, 10, 0, 0)

function mountPicker(props = {}, options = {}) {
  return mount(TaskSchedulePicker, { props, ...options })
}
async function open(wrapper) {
  await wrapper.get('.task-panel-schedule').trigger('click')
  await flushPromises()
}
function shortcut(wrapper, id) {
  return wrapper.get(`.task-schedule-shortcut[data-shortcut="${id}"]`)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TaskSchedulePicker', () => {
  it('reads the schedule on the chip', () => {
    expect(mountPicker().get('.task-panel-schedule').text()).toContain('No date')
    expect(mountPicker({ dueDate: '2026-10-16' }).get('.task-panel-schedule').text()).toContain(
      'Today',
    )
    const full = mountPicker({ dueDate: '2026-10-24', dueTime: '15:00', recurrence: 'every day' })
    expect(full.get('.task-panel-schedule').text()).toContain('Sat 24 Oct · 15:00')
    expect(full.get('.task-panel-schedule').attributes('aria-label')).toBe(
      'Schedule: Sat 24 Oct · 15:00',
    )
    expect(full.find('.task-panel-schedule-repeat').exists()).toBe(true)
  })

  it('drops the date box, shortcuts with their days, and a year of months', async () => {
    const wrapper = mountPicker({ dueDate: '2026-10-16' })
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)

    await open(wrapper)

    expect(wrapper.get('.task-panel-date-input').element.value).toBe('16 Oct')
    expect(shortcut(wrapper, 'tomorrow').text()).toContain('Sat')
    expect(shortcut(wrapper, 'next-week').text()).toContain('Mon 19 Oct')
    expect(shortcut(wrapper, 'next-weekend').text()).toContain('Sat 24 Oct')
    expect(wrapper.get('.task-schedule-calendar-head strong').text()).toBe('Oct 2026')
    expect(wrapper.findAll('.task-schedule-month')).toHaveLength(12)
    expect(wrapper.findAll('.task-schedule-month h4').map((node) => node.text())[0]).toBe(
      'Nov 2026',
    )
    const today = wrapper.get('.task-schedule-day[data-date="2026-10-16"]')
    expect(today.classes()).toContain('today')
    expect(today.classes()).toContain('selected')
    expect(today.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.task-schedule-day[data-date="2026-10-15"]').classes()).toContain('past')
    expect(wrapper.get('.task-schedule-day[data-date="2026-10-17"]').classes()).toContain('weekend')
    // Monday-first: the 1st of October 2026 is a Thursday, three blanks lead it.
    expect(wrapper.findAll('.task-schedule-week')[0].findAll('.task-schedule-blank')).toHaveLength(
      3,
    )
  })

  it('starts the calendar at a due date already in the past', async () => {
    const wrapper = mountPicker({ dueDate: '2026-08-03' })
    await open(wrapper)

    expect(wrapper.get('.task-schedule-calendar-head strong').text()).toBe('Aug 2026')
    expect(wrapper.find('.task-schedule-day[data-date="2026-08-03"]').exists()).toBe(true)
  })

  it('offers Today first and selects the current local date, including after midnight', async () => {
    const wrapper = mountPicker({ dueDate: '2026-10-24' })
    await open(wrapper)

    expect(wrapper.findAll('.task-schedule-shortcut')[0].attributes('data-shortcut')).toBe('today')
    expect(shortcut(wrapper, 'today').text()).toContain('Today')
    await shortcut(wrapper, 'today').trigger('click')
    expect(wrapper.emitted('update:dueDate')).toEqual([['2026-10-16']])
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)

    vi.setSystemTime(new Date(2026, 9, 17, 0, 1))
    await open(wrapper)
    await shortcut(wrapper, 'today').trigger('click')
    expect(wrapper.emitted('update:dueDate').at(-1)).toEqual(['2026-10-17'])
  })

  it('chooses a shortcut, a day, or no date and closes', async () => {
    const wrapper = mountPicker()
    await open(wrapper)
    await shortcut(wrapper, 'next-weekend').trigger('click')
    expect(wrapper.emitted('update:dueDate')).toEqual([['2026-10-24']])
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)

    await open(wrapper)
    await wrapper.get('.task-schedule-day[data-date="2026-11-05"]').trigger('click')
    expect(wrapper.emitted('update:dueDate').at(-1)).toEqual(['2026-11-05'])

    await wrapper.setProps({ dueDate: '2026-11-05' })
    await open(wrapper)
    await wrapper.get('.task-schedule-nodate').trigger('click')
    expect(wrapper.emitted('update:dueDate').at(-1)).toEqual([null])
  })

  it('does not re-emit the date the task already has', async () => {
    const wrapper = mountPicker({ dueDate: '2026-10-24' })
    await open(wrapper)
    await wrapper.get('.task-schedule-day[data-date="2026-10-24"]').trigger('click')

    expect(wrapper.emitted('update:dueDate')).toBeUndefined()
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)
  })

  it('reads a typed date on Enter and explains one it cannot', async () => {
    const wrapper = mountPicker()
    await open(wrapper)
    const input = wrapper.get('.task-panel-date-input')

    await input.setValue('soon')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('.task-schedule-error').text()).toContain('Could not read that date')
    expect(wrapper.emitted('update:dueDate')).toBeUndefined()

    await input.setValue('tomorrow')
    expect(wrapper.find('.task-schedule-error').exists()).toBe(false)
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:dueDate')).toEqual([['2026-10-17']])
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)
  })

  it('keeps an overdue or later-year date when its box is submitted unchanged', async () => {
    const overdue = mountPicker({ dueDate: '2026-08-01' })
    await open(overdue)
    expect(overdue.get('.task-panel-date-input').element.value).toBe('1 Aug')
    await overdue.get('.task-panel-date-input').trigger('keydown', { key: 'Enter' })
    expect(overdue.emitted('update:dueDate')).toBeUndefined()
    expect(overdue.find('.task-schedule-menu').exists()).toBe(false)

    const later = mountPicker({ dueDate: '2028-03-05' })
    await open(later)
    await later.get('.task-panel-date-input').trigger('keydown', { key: 'Enter' })
    expect(later.emitted('update:dueDate')).toBeUndefined()

    // An edit is still read as typed.
    await open(overdue)
    await overdue.get('.task-panel-date-input').setValue('2 Aug')
    await overdue.get('.task-panel-date-input').trigger('keydown', { key: 'Enter' })
    expect(overdue.emitted('update:dueDate')).toEqual([['2027-08-02']])
  })

  it('reaches both a long-overdue due month and this month on the calendar', async () => {
    const wrapper = mountPicker({ dueDate: '2020-01-15' })
    await open(wrapper)
    const labels = wrapper
      .findAll('.task-schedule-month')
      .map((node) => node.attributes('aria-label'))
    expect(labels[0]).toBe('Jan 2020')
    expect(labels).toContain('Oct 2026')
    expect(labels.at(-1)).toMatch(/^Sept? 2027$/)

    const [, current] = wrapper.findAll('.task-schedule-nav button')
    await current.trigger('click')
    expect(wrapper.get('.task-schedule-calendar-head strong').text()).toBe('Oct 2026')

    const future = mountPicker({ dueDate: '2028-06-01' })
    await open(future)
    const ahead = future
      .findAll('.task-schedule-month')
      .map((node) => node.attributes('aria-label'))
    expect(ahead[0]).toBe('Oct 2026')
    expect(ahead.at(-1)).toBe('Jun 2028')
  })

  it('scrolls to a month by its place in the calendar, not in the menu', async () => {
    const wrapper = mountPicker({}, { attachTo: document.body })
    await open(wrapper)
    const calendar = wrapper.get('.task-schedule-calendar').element
    const sections = wrapper.findAll('.task-schedule-month').map((node) => node.element)
    // The calendar sits 300px down the menu; each month is 200px tall.
    calendar.getBoundingClientRect = () => ({ top: 300 })
    sections.forEach((section, index) => {
      Object.defineProperty(section, 'offsetTop', { value: 300 + index * 200 })
      section.getBoundingClientRect = () => ({ top: 300 + index * 200 - calendar.scrollTop })
    })

    const [, , next] = wrapper.findAll('.task-schedule-nav button')
    await next.trigger('click')
    expect(calendar.scrollTop).toBe(200)
    calendar.scrollTop = 0
    await wrapper.get('.task-schedule-calendar').trigger('scroll')
    expect(wrapper.get('.task-schedule-calendar-head strong').text()).toBe('Oct 2026')
    wrapper.unmount()
  })

  it('steps months with the arrows and returns to this month', async () => {
    const wrapper = mountPicker()
    await open(wrapper)
    const [previous, current, next] = wrapper.findAll('.task-schedule-nav button')
    expect(previous.attributes('disabled')).toBeDefined()

    await next.trigger('click')
    expect(wrapper.get('.task-schedule-calendar-head strong').text()).toBe('Nov 2026')
    expect(previous.attributes('disabled')).toBeUndefined()
    await current.trigger('click')
    expect(wrapper.get('.task-schedule-calendar-head strong').text()).toBe('Oct 2026')
  })

  it('keeps the time and repeat editors behind their buttons', async () => {
    const wrapper = mountPicker({
      dueDate: '2026-10-24',
      dueTime: '15:00',
      timeZone: 'Europe/London',
      recurrence: 'every day',
    })
    await open(wrapper)
    expect(wrapper.find('.task-panel-time-input').exists()).toBe(false)
    expect(wrapper.find('.task-repeat').exists()).toBe(false)
    expect(wrapper.get('.task-schedule-time-toggle').text()).toContain('Time · 15:00')
    expect(wrapper.get('.task-schedule-repeat-toggle').text()).toContain('Repeat · every day')

    await wrapper.get('.task-schedule-time-toggle').trigger('click')
    expect(wrapper.get('.task-panel-time-input').element.value).toBe('15:00')
    expect(wrapper.text()).toContain('Europe/London')
    await wrapper.get('.task-panel-time-input').setValue('16:30')
    expect(wrapper.emitted('update:dueTime')).toEqual([['16:30']])

    await wrapper.get('.task-schedule-repeat-toggle').trigger('click')
    expect(wrapper.get('.task-repeat input').element.value).toBe('every day')
    await wrapper.get('.task-repeat input').setValue('every Monday')
    await wrapper.get('form.task-panel-repeat').trigger('submit')
    expect(wrapper.emitted('saveRecurrence')).toEqual([['every Monday']])
    // Saving does not close the list: the person may go on to the date.
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(true)
  })

  it('disables the time until there is a date', async () => {
    const wrapper = mountPicker()
    await open(wrapper)
    await wrapper.get('.task-schedule-time-toggle').trigger('click')

    expect(wrapper.get('.task-panel-time-input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Choose a date first.')
  })

  it('closes on Escape without letting the panel see it, and on a press outside', async () => {
    const wrapper = mountPicker({}, { attachTo: document.body })
    await open(wrapper)
    expect(document.activeElement).toBe(wrapper.get('.task-panel-date-input').element)

    const seen = []
    const spy = () => seen.push('escape')
    document.addEventListener('keydown', spy)
    await wrapper.get('.task-panel-date-input').trigger('keydown', { key: 'Escape' })
    document.removeEventListener('keydown', spy)
    expect(seen).toEqual([])
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('.task-panel-schedule').element)

    await open(wrapper)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens from the outside with the date box focused', async () => {
    const wrapper = mountPicker({}, { attachTo: document.body })
    await wrapper.vm.open()
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('.task-panel-date-input').element)
    wrapper.unmount()
  })
})
