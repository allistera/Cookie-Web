import { describe, expect, it } from 'vitest'
import { SOMEDAY } from '../taskSomeday'
import { inboxRailTasks, railDayLabel, railDue, todayRailTasks } from '../tasksRail'

const TODAY = '2026-11-27'

describe('railDayLabel', () => {
  it('names the weekday, day and month', () => {
    expect(railDayLabel(TODAY)).toBe('Fri 27 Nov')
    expect(railDayLabel('2026-09-01')).toBe('Tue 1 Sep')
  })
})

describe('rail task lists', () => {
  const rows = [
    { id: 'a', content: 'Open' },
    { id: 'b', content: 'Rule', kind: 'divider' },
    { id: 'c', content: 'Step', parentId: 'a' },
    { id: 'd', content: 'Done', completedAt: '2026-11-27T09:00:00Z' },
    { id: 'e', content: 'Due today', dueDate: TODAY },
    { id: 'f', content: 'Late', dueDate: '2026-11-26' },
    { id: 'g', content: 'Tomorrow', dueDate: '2026-11-28' },
    { id: 'h', content: 'Someday', dueDate: SOMEDAY },
  ]

  it('lists open top-level tasks only', () => {
    expect(todayRailTasks(rows).map((row) => row.id)).toEqual(['a', 'e', 'f', 'g', 'h'])
  })

  it('leaves tasks that are already due out of Inbox', () => {
    expect(inboxRailTasks(rows, TODAY).map((row) => row.id)).toEqual(['a', 'g', 'h'])
  })
})

describe('railDue', () => {
  it('says nothing for a task due today with no time, or with no day', () => {
    expect(railDue({ dueDate: TODAY }, TODAY)).toEqual({ text: '', overdue: false })
    expect(railDue({ dueDate: SOMEDAY }, TODAY)).toEqual({ text: '', overdue: false })
    expect(railDue({}, TODAY)).toEqual({ text: '', overdue: false })
  })

  it('names the time of a task due today', () => {
    expect(railDue({ dueDate: TODAY, dueTime: '13:00' }, TODAY).text).toBe('13:00')
  })

  it('marks a late task and names its day', () => {
    expect(railDue({ dueDate: '2026-11-26' }, TODAY)).toEqual({
      text: 'Overdue · 26 Nov',
      overdue: true,
    })
  })

  it('names the day of a later task', () => {
    expect(railDue({ dueDate: '2026-11-28', dueTime: '09:30' }, TODAY)).toEqual({
      text: '28 Nov · 09:30',
      overdue: false,
    })
  })
})
