import { describe, expect, it } from 'vitest'

import { activityEntries, describeChange, displayValue } from '../taskActivity'

const lookups = {
  projectName: (id) => ({ p1: 'Cookie' })[id],
  taskTitle: (id) => ({ t1: 'Parent' })[id],
}

describe('displayValue', () => {
  it('names projects, the Inbox, parents and priorities', () => {
    expect(displayValue('p1', 'project_id', lookups)).toBe('Cookie')
    expect(displayValue('gone', 'project_id', lookups)).toBe('Another project')
    expect(displayValue(null, 'project_id', lookups)).toBe('Inbox')
    expect(displayValue('t1', 'parent_id', lookups)).toBe('Parent')
    expect(displayValue('gone', 'parent_id', lookups)).toBe('Another task')
    expect(displayValue(null, 'parent_id', lookups)).toBe('None')
    expect(displayValue(1, 'priority')).toBe('P1')
    expect(displayValue(['a', 'b'], 'labels')).toBe('a, b')
    expect(displayValue([], 'labels')).toBe('None')
    expect(displayValue('', 'due_date')).toBe('None')
  })
})

describe('describeChange', () => {
  it('reads a rename, a move and a set, cleared or changed field', () => {
    expect(describeChange('content', { before: 'Old', after: 'New' })).toBe(
      'Title changed from “Old” to “New”',
    )
    expect(describeChange('project_id', { before: null, after: 'p1' }, lookups)).toBe(
      'Moved to Cookie',
    )
    expect(describeChange('project_id', { before: 'p1', after: null }, lookups)).toBe(
      'Moved to Inbox',
    )
    expect(describeChange('due_date', { before: null, after: '2026-10-20' })).toBe(
      'Due date set to 2026-10-20',
    )
    expect(describeChange('due_date', { before: '2026-10-20', after: null })).toBe(
      'Due date cleared',
    )
    expect(describeChange('priority', { before: 4, after: 1 })).toBe(
      'Priority changed from P4 to P1',
    )
    expect(describeChange('labels', { before: [], after: ['home'] })).toBe('Labels set to home')
    expect(describeChange('parent_id', { before: null, after: 't1' }, lookups)).toBe(
      'Parent task set to “Parent”',
    )
    expect(describeChange('mystery', { before: 'a', after: 'b' })).toBe(
      'mystery changed from a to b',
    )
  })

  // A description can run to pages, so only the fact of the edit is read.
  it('does not repeat a description or an order value', () => {
    expect(describeChange('description', { before: null, after: 'Long text' })).toBe(
      'Description added',
    )
    expect(describeChange('description', { before: 'Long', after: 'Longer' })).toBe(
      'Description edited',
    )
    expect(describeChange('description', { before: 'Long', after: '' })).toBe('Description cleared')
    expect(describeChange('position', { before: 1, after: 2 })).toBe('Reordered')
  })
})

describe('activityEntries', () => {
  it('gives one bullet per event and one per edited field', () => {
    const entries = activityEntries(
      [
        { id: 'e1', action: 'created', occurredAt: '2026-10-16T09:00:00Z', changes: {} },
        {
          id: 'e2',
          action: 'edited',
          occurredAt: '2026-10-16T09:05:00Z',
          changes: {
            content: { before: 'Old', after: 'New' },
            priority: { before: 4, after: 2 },
          },
        },
        { id: 'e3', action: 'completed', occurredAt: '2026-10-16T09:10:00Z', changes: {} },
      ],
      lookups,
    )

    expect(entries).toEqual([
      { id: 'e1', text: 'Created', occurredAt: '2026-10-16T09:00:00Z' },
      {
        id: 'e2:content',
        text: 'Title changed from “Old” to “New”',
        occurredAt: '2026-10-16T09:05:00Z',
      },
      {
        id: 'e2:priority',
        text: 'Priority changed from P4 to P2',
        occurredAt: '2026-10-16T09:05:00Z',
      },
      { id: 'e3', text: 'Completed', occurredAt: '2026-10-16T09:10:00Z' },
    ])
  })

  it('collapses a reorder that touched both order columns into one bullet', () => {
    const entries = activityEntries([
      {
        id: 'e1',
        action: 'edited',
        occurredAt: '2026-10-16T09:00:00Z',
        changes: { position: { before: 1, after: 2 }, today_position: { before: 1, after: 2 } },
      },
    ])

    expect(entries.map((entry) => entry.text)).toEqual(['Reordered'])
  })

  it('reads an edit without recorded changes as a plain edit', () => {
    expect(
      activityEntries([{ id: 'e1', action: 'edited', occurredAt: '', changes: {} }]).map(
        (entry) => entry.text,
      ),
    ).toEqual(['Edited'])
  })
})
