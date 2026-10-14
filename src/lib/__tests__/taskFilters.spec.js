import { describe, expect, it } from 'vitest'

import {
  addDays,
  defaultRuleValue,
  describeRule,
  filterDraftError,
  filterIdOf,
  filterRoute,
  isFilterProject,
  newFilterRule,
  taskMatchesFilter,
} from '../taskFilters'

const TODAY = '2026-10-14'
const TASK = {
  id: 't1',
  kind: 'task',
  projectId: 'p1',
  dueDate: TODAY,
  priority: 1,
  labels: ['home'],
}

function filter(rules, match = 'all') {
  return { id: 'f1', name: 'Test', match, rules }
}

describe('filter projects', () => {
  it('recognises a filter list and reads its id back', () => {
    expect(isFilterProject('filter:f1')).toBe(true)
    expect(isFilterProject('label:home')).toBe(false)
    expect(isFilterProject(null)).toBe(false)
    expect(filterIdOf('filter:f1')).toBe('f1')
    expect(filterIdOf('inbox')).toBe('')
    expect(filterRoute({ id: 'f1' })).toEqual({ path: '/tasks', query: { project: 'filter:f1' } })
  })
})

describe('addDays', () => {
  it('moves a calendar date without a zone getting in the way', () => {
    expect(addDays('2026-10-14', 1)).toBe('2026-10-15')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
  })
})

describe('taskMatchesFilter', () => {
  it.each([
    ['overdue', { ...TASK, dueDate: '2026-10-13' }, true],
    ['overdue', TASK, false],
    ['today', TASK, true],
    ['today', { ...TASK, dueDate: '2026-10-15' }, false],
    ['tomorrow', { ...TASK, dueDate: '2026-10-15' }, true],
    ['week', { ...TASK, dueDate: '2026-10-20' }, true],
    ['week', { ...TASK, dueDate: '2026-10-21' }, false],
    ['week', { ...TASK, dueDate: '2026-10-13' }, false],
    ['none', { ...TASK, dueDate: null }, true],
    ['none', TASK, false],
    ['any', TASK, true],
    ['any', { ...TASK, dueDate: null }, false],
  ])('judges a %s due rule', (value, item, expected) => {
    expect(taskMatchesFilter(item, filter([{ field: 'due', value }]), TODAY)).toBe(expected)
  })

  // An undated task is not overdue, so excluding overdue tasks keeps it —
  // the same answer the Worker's COALESCE gives.
  it('counts an undated task as not overdue when the rule excludes overdue', () => {
    const rule = { field: 'due', value: 'overdue', negate: true }
    expect(taskMatchesFilter({ ...TASK, dueDate: null }, filter([rule]), TODAY)).toBe(true)
    expect(taskMatchesFilter({ ...TASK, dueDate: '2026-01-01' }, filter([rule]), TODAY)).toBe(false)
  })

  it('matches projects, the Inbox, priorities and labels', () => {
    expect(taskMatchesFilter(TASK, filter([{ field: 'project', value: 'p1' }]), TODAY)).toBe(true)
    expect(taskMatchesFilter(TASK, filter([{ field: 'project', value: 'p2' }]), TODAY)).toBe(false)
    expect(
      taskMatchesFilter(
        { ...TASK, projectId: null },
        filter([{ field: 'project', value: 'inbox' }]),
        TODAY,
      ),
    ).toBe(true)
    expect(taskMatchesFilter(TASK, filter([{ field: 'priority', value: 1 }]), TODAY)).toBe(true)
    expect(
      taskMatchesFilter(
        { ...TASK, priority: undefined },
        filter([{ field: 'priority', value: 4 }]),
        TODAY,
      ),
    ).toBe(true)
    expect(taskMatchesFilter(TASK, filter([{ field: 'label', value: 'home' }]), TODAY)).toBe(true)
    expect(taskMatchesFilter(TASK, filter([{ field: 'label', value: 'work' }]), TODAY)).toBe(false)
  })

  it('needs every rule for all and one for any, honouring exclusions', () => {
    const rules = [
      { field: 'priority', value: 1 },
      { field: 'label', value: 'work', negate: true },
    ]
    expect(taskMatchesFilter(TASK, filter(rules, 'all'), TODAY)).toBe(true)
    expect(taskMatchesFilter({ ...TASK, labels: ['work'] }, filter(rules, 'all'), TODAY)).toBe(
      false,
    )
    expect(taskMatchesFilter({ ...TASK, labels: ['work'] }, filter(rules, 'any'), TODAY)).toBe(true)
    expect(
      taskMatchesFilter({ ...TASK, labels: ['work'], priority: 4 }, filter(rules, 'any'), TODAY),
    ).toBe(false)
  })

  it('never lists a divider, and matches nothing without rules', () => {
    const rule = { field: 'due', value: 'none' }
    expect(taskMatchesFilter({ kind: 'divider', dueDate: null }, filter([rule]), TODAY)).toBe(false)
    expect(taskMatchesFilter(TASK, filter([]), TODAY)).toBe(false)
    expect(taskMatchesFilter(TASK, null, TODAY)).toBe(false)
  })
})

describe('editor drafts', () => {
  it('starts a rule with a legal value for its field', () => {
    expect(newFilterRule()).toEqual({ field: 'due', value: 'today', negate: false })
    expect(defaultRuleValue('project')).toBe('inbox')
    expect(defaultRuleValue('priority')).toBe(1)
    expect(defaultRuleValue('label', { labels: [{ name: 'home' }] })).toBe('home')
    expect(defaultRuleValue('label')).toBe('')
  })

  it('says why a draft cannot be saved yet', () => {
    const rule = { field: 'due', value: 'today', negate: false }
    expect(filterDraftError({ name: ' ', rules: [rule] })).toBe('Give the filter a name.')
    expect(filterDraftError({ name: 'Mine', rules: [] })).toBe('Add at least one rule.')
    expect(filterDraftError({ name: 'Mine', rules: Array(11).fill(rule) })).toBe(
      'Use at most 10 rules.',
    )
    expect(filterDraftError({ name: 'Mine', rules: [{ field: 'label', value: '' }] })).toBe(
      'Choose a label for every label rule.',
    )
    expect(filterDraftError({ name: 'Mine', rules: [{ field: 'project', value: '' }] })).toBe(
      'Choose a project for every project rule.',
    )
    expect(filterDraftError({ name: 'Mine', rules: [rule] })).toBe('')
    expect(filterDraftError(null)).toBe('Give the filter a name.')
  })
})

describe('describeRule', () => {
  const projects = [{ id: 'p1', name: 'Work' }]

  it('names the field and value the way the sidebar does', () => {
    expect(describeRule({ field: 'due', value: 'week' })).toEqual({
      field: 'Due',
      value: 'In the next 7 days',
      negate: false,
    })
    expect(describeRule({ field: 'project', value: 'p1', negate: true }, { projects })).toEqual({
      field: 'Project',
      value: 'Work',
      negate: true,
    })
    expect(describeRule({ field: 'project', value: 'inbox' })).toMatchObject({ value: 'Inbox' })
    expect(describeRule({ field: 'project', value: 'gone' }, { projects })).toMatchObject({
      value: 'Deleted project',
    })
    expect(describeRule({ field: 'priority', value: 2 })).toMatchObject({
      field: 'Priority',
      value: 'P2',
    })
    expect(describeRule({ field: 'label', value: 'home' })).toMatchObject({
      field: 'Label',
      value: '@home',
    })
  })
})
