// Task priority, Todoist-style: 1 is the most urgent, 4 is the default and
// reads as "no priority" — its flag takes the muted text colour rather than
// a colour of its own. The server (cookie-web-tasks) enforces the same 1..4
// range and default; this is the one place the UI names the levels.

export const DEFAULT_PRIORITY = 4

export const PRIORITIES = [
  { value: 1, label: 'Priority 1', short: 'P1', color: '#d1453b' },
  { value: 2, label: 'Priority 2', short: 'P2', color: '#eb8909' },
  { value: 3, label: 'Priority 3', short: 'P3', color: '#246fe0' },
  { value: 4, label: 'Priority 4', short: 'P4', color: null },
]

// Any task loaded before migration 0058 — or a test fixture that never
// mentions the field — is the default, not a broken row.
export function priorityOf(item) {
  const value = item?.priority
  return PRIORITIES.some((row) => row.value === value) ? value : DEFAULT_PRIORITY
}

export function priorityInfo(value) {
  return PRIORITIES.find((row) => row.value === value) ?? PRIORITIES[PRIORITIES.length - 1]
}
