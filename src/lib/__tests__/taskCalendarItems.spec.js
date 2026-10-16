import { describe, expect, it } from 'vitest'

import {
  TASKS_CALENDAR_COLOR,
  TASKS_CALENDAR_ID,
  taskToCalendarItem,
  taskToCalendarItems,
} from '../taskCalendarItems'

const task = {
  id: 'task-1',
  projectId: 'project-9',
  parentId: null,
  content: 'Renew car insurance',
  dueDate: '2026-09-22',
  dueTime: null,
  timeZone: null,
  priority: 2,
}

// A task with a date sits on the calendar next to that day's events. It is
// not an event: it lands in the all-day banner unless it carries a time.
// Timed tasks use their estimate, or the default thirty-minute slot.
describe('taskToCalendarItem', () => {
  it('maps an undated-time task to an all-day item on its due date', () => {
    expect(taskToCalendarItem(task)).toEqual({
      id: 'task:task-1',
      kind: 'task',
      taskId: 'task-1',
      projectId: 'project-9',
      title: 'Renew car insurance',
      date: '2026-09-22',
      start: '00:00',
      duration: 1440,
      allDay: true,
      calendar: TASKS_CALENDAR_ID,
      priority: 2,
    })
  })

  it('maps a task with a due time to a thirty-minute slot at that time', () => {
    const item = taskToCalendarItem({ ...task, dueTime: '14:30' })
    expect(item).toMatchObject({ start: '14:30', duration: 30, allDay: false })
  })

  it('uses the estimate for a timed task, including one crossing midnight', () => {
    expect(taskToCalendarItem({ ...task, dueTime: '23:30', durationMinutes: 90 })).toMatchObject({
      start: '23:30',
      duration: 90,
      allDay: false,
    })
  })

  it('keeps an estimated task without a time in the all-day banner', () => {
    expect(taskToCalendarItem({ ...task, durationMinutes: 90 })).toMatchObject({
      duration: 1440,
      allDay: true,
    })
  })

  it('uses the default slot after the estimate is cleared', () => {
    expect(taskToCalendarItem({ ...task, dueTime: '10:00', durationMinutes: null }).duration).toBe(
      30,
    )
  })

  it('splits an estimate across calendar days, preserving task navigation', () => {
    const items = taskToCalendarItems({
      ...task,
      dueDate: '2026-12-31',
      dueTime: '10:00',
      durationMinutes: 1440,
    })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      date: '2026-12-31',
      start: '10:00',
      duration: 840,
      allDay: false,
    })
    expect(items[1]).toMatchObject({
      date: '2027-01-01',
      start: '00:00',
      duration: 600,
      allDay: false,
      taskId: task.id,
    })
    expect(items[1].id).not.toBe(items[0].id)
  })

  it('does not add a segment when an estimate ends exactly at midnight', () => {
    expect(taskToCalendarItems({ ...task, dueTime: '23:00', durationMinutes: 60 })).toHaveLength(1)
  })

  it('sends a task with no project to the Inbox', () => {
    expect(taskToCalendarItem({ ...task, projectId: null }).projectId).toBe('inbox')
  })

  it('exposes the pseudo-calendar identity the sidebar toggles', () => {
    expect(TASKS_CALENDAR_ID).toBe('tasks')
    expect(TASKS_CALENDAR_COLOR).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
