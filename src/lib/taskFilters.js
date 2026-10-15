// Extensions spelled out: the e2e fixture (scripts/localApi/plugin.js)
// imports this module into Vite's config, which resolves imports natively.
import { normalizeLabelName } from './taskLabels.js'
import { PRIORITIES, priorityOf } from './taskPriority.js'

// Saved task filters: a named set of rules on due date, project, priority
// and labels, matched as all or any, each rule negatable, listing the tasks
// it fits across every project. The Worker (cookie-web-tasks/taskFilters.js)
// stores them and runs them in SQL; this mirrors its rules one for one so the
// list on screen can tell whether an edited task still belongs on it without
// asking the server, and so the editor can offer exactly what the server
// will accept.

export const MAX_FILTER_RULES = 10

export const FILTER_FIELDS = [
  { value: 'due', label: 'Due' },
  { value: 'project', label: 'Project' },
  { value: 'priority', label: 'Priority' },
  { value: 'label', label: 'Label' },
]

export const DUE_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'In the next 7 days' },
  { value: 'any', label: 'Any date' },
  { value: 'none', label: 'No date' },
]

export function isFilterProject(project) {
  return String(project ?? '').startsWith('filter:')
}

export function filterIdOf(project) {
  return isFilterProject(project) ? String(project).slice('filter:'.length) : ''
}

export function filterRoute(filter) {
  return { path: '/tasks', query: { project: `filter:${filter.id}` } }
}

// YYYY-MM-DD moved by `days`, in UTC so no zone can shift the day.
export function addDays(date, days) {
  const [year, month, day] = String(date)
    .split('-')
    .map((part) => Number(part))
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// The value a rule starts with when its field is chosen: something that is
// always a legal choice, so a fresh rule is never half-made.
export function defaultRuleValue(field, { labels = [] } = {}) {
  if (field === 'project') return 'inbox'
  if (field === 'priority') return 1
  if (field === 'label') return labels[0]?.name ?? ''
  return 'today'
}

export function newFilterRule(field = 'due', options = {}) {
  return { field, value: defaultRuleValue(field, options), negate: false }
}

// Why a draft cannot be saved yet, or '' when it can. The server checks the
// same things again (and more); this keeps the Save button honest.
export function filterDraftError(draft) {
  if (!String(draft?.name ?? '').trim()) return 'Give the filter a name.'
  const rules = Array.isArray(draft?.rules) ? draft.rules : []
  if (!rules.length) return 'Add at least one rule.'
  if (rules.length > MAX_FILTER_RULES) return `Use at most ${MAX_FILTER_RULES} rules.`
  for (const rule of rules) {
    if (rule.field === 'label' && !normalizeLabelName(rule.value)) {
      return 'Choose a label for every label rule.'
    }
    if (rule.field === 'project' && !rule.value) return 'Choose a project for every project rule.'
  }
  return ''
}

function ruleMatches(item, rule, today) {
  if (rule.field === 'due') {
    const due = item.dueDate || null
    switch (rule.value) {
      case 'overdue':
        return Boolean(due) && due < today
      case 'today':
        return due === today
      case 'tomorrow':
        return due === addDays(today, 1)
      case 'week':
        return Boolean(due) && due >= today && due < addDays(today, 7)
      case 'none':
        return !due
      case 'any':
        return Boolean(due)
      default:
        return false
    }
  }
  if (rule.field === 'project') {
    return rule.value === 'inbox' ? !item.projectId : item.projectId === rule.value
  }
  if (rule.field === 'priority') return priorityOf(item) === Number(rule.value)
  if (rule.field === 'label') return Boolean(item.labels?.includes(rule.value))
  return false
}

// Whether a task fits the filter on the given calendar date. A divider is
// never a result, whatever the rules; nor is anything from a filter with no
// rules, which the server refuses to store anyway.
export function taskMatchesFilter(item, filter, today) {
  const rules = Array.isArray(filter?.rules) ? filter.rules : []
  if (!rules.length || item?.kind === 'divider') return false
  const results = rules.map((rule) => ruleMatches(item, rule, today) !== Boolean(rule.negate))
  return filter.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

// One rule in words, for the chips under a filter's title: the field, then
// the value as the sidebar names it. `projects` are the loaded rows; a
// project they no longer know is said to be deleted rather than hidden.
export function describeRule(rule, { projects = [] } = {}) {
  let value
  if (rule.field === 'due') {
    value = DUE_OPTIONS.find((option) => option.value === rule.value)?.label ?? String(rule.value)
  } else if (rule.field === 'project') {
    value =
      rule.value === 'inbox'
        ? 'Inbox'
        : (projects.find((project) => project.id === rule.value)?.name ?? 'Deleted project')
  } else if (rule.field === 'priority') {
    value = PRIORITIES.find((priority) => priority.value === Number(rule.value))?.short ?? 'P4'
  } else {
    value = `@${rule.value}`
  }
  const field = FILTER_FIELDS.find((option) => option.value === rule.field)?.label ?? rule.field
  return { field, value, negate: Boolean(rule.negate) }
}
