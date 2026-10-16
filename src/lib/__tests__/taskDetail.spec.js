import { describe, expect, it } from 'vitest'

import {
  formatAddedStamp,
  shortUserName,
  sortSubtasks,
  taskAsText,
  taskSiblings,
  userInitial,
} from '../taskDetail'

describe('shortUserName', () => {
  it('keeps the first name and initials the last', () => {
    expect(shortUserName('Allister Antosik')).toBe('Allister A.')
    expect(shortUserName('Mary Anne van der Berg')).toBe('Mary B.')
  })

  it('keeps a lone word and trims an address to its local part', () => {
    expect(shortUserName('Allister')).toBe('Allister')
    expect(shortUserName('allister@example.com')).toBe('allister')
    expect(shortUserName('')).toBe('')
    expect(shortUserName(null)).toBe('')
  })
})

describe('userInitial', () => {
  it('takes the first letter, upper-cased, with a fallback', () => {
    expect(userInitial('allister')).toBe('A')
    expect(userInitial('')).toBe('?')
  })
})

describe('formatAddedStamp', () => {
  it('shows day, month and time, adding the year when it differs', () => {
    const now = new Date('2026-10-16T12:00:00')
    expect(formatAddedStamp('2026-10-16T14:11:00', now)).toBe('16 Oct · 14:11')
    expect(formatAddedStamp('2025-02-03T09:05:00', now)).toBe('3 Feb 2025 · 09:05')
  })

  it('is empty for a missing or broken stamp', () => {
    expect(formatAddedStamp(null)).toBe('')
    expect(formatAddedStamp('yesterday')).toBe('')
  })
})

describe('taskSiblings', () => {
  const rows = [
    { id: 'a', parentId: null },
    { id: 'd', kind: 'divider', parentId: null },
    { id: 'b', parentId: null },
    { id: 's', parentId: 'b' },
  ]

  it('lists the rows beside a task, skipping dividers', () => {
    expect(taskSiblings(rows, rows[2]).map((row) => row.id)).toEqual(['a', 'b'])
    expect(taskSiblings(rows, rows[3]).map((row) => row.id)).toEqual(['s'])
    expect(taskSiblings(rows, null)).toEqual([])
  })
})

describe('sortSubtasks', () => {
  const rows = [
    { id: '1', content: 'b', dueDate: null, priority: 4 },
    { id: '2', content: 'a', dueDate: '2026-10-02', dueTime: '09:00', priority: 1 },
    { id: '3', content: 'c', dueDate: '2026-10-02', priority: 2 },
  ]

  it('orders by name, date and priority, or leaves the manual order', () => {
    expect(sortSubtasks(rows, 'name').map((row) => row.id)).toEqual(['2', '1', '3'])
    expect(sortSubtasks(rows, 'date').map((row) => row.id)).toEqual(['2', '3', '1'])
    expect(sortSubtasks(rows, 'priority').map((row) => row.id)).toEqual(['2', '3', '1'])
    expect(sortSubtasks(rows, 'manual')).toBe(rows)
  })
})

describe('taskAsText', () => {
  it('writes the title, description and a checklist of sub-tasks', () => {
    expect(
      taskAsText({ content: 'Title', description: '# Notes' }, [
        { content: 'one', completedAt: null },
        { content: 'two', completedAt: '2026-10-16T00:00:00Z' },
      ]),
    ).toBe('Title\n\n# Notes\n\n- [ ] one\n- [x] two')
  })

  it('is just the title when there is nothing else', () => {
    expect(taskAsText({ content: 'Title', description: null })).toBe('Title')
  })
})
