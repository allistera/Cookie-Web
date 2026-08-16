const DEFAULT_LANE_TITLES = ['Todo', 'In Progress', 'Done']

function isRecord(value) {
  return value !== null && Object(value) === value && !Array.isArray(value)
}

// String-like check via duck typing (does it have String.prototype.trim?)
// rather than `typeof value === 'string'`, matching normalizeDocumentTag's
// approach in documentTags.js.
function isNonEmptyString(value) {
  return value?.trim instanceof Function && value.length > 0
}

function createId() {
  if (crypto?.randomUUID instanceof Function) return crypto.randomUUID()
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

function normalizeString(value) {
  return value?.trim instanceof Function ? value : ''
}

export function createKanbanTask(overrides = {}) {
  return { id: createId(), title: '', description: '', ...overrides }
}

export function createKanbanLane(title, overrides = {}) {
  return { id: createId(), title, tasks: [], ...overrides }
}

export function createDefaultKanbanBoard() {
  return { lanes: DEFAULT_LANE_TITLES.map((title) => createKanbanLane(title)) }
}

function normalizeTask(value) {
  if (!isRecord(value)) return null
  return {
    id: isNonEmptyString(value.id) ? value.id : createId(),
    title: normalizeString(value.title),
    description: normalizeString(value.description),
  }
}

function normalizeLane(value) {
  if (!isRecord(value)) return null
  const tasks = Array.isArray(value.tasks) ? value.tasks.map(normalizeTask).filter(Boolean) : []
  return {
    id: isNonEmptyString(value.id) ? value.id : createId(),
    title: normalizeString(value.title),
    tasks,
  }
}

// A freshly-inserted "/" block hands tools an empty `{}` (no `lanes` key at
// all) - that's the only case that gets the product-default Todo/In
// Progress/Done starting lanes. A board the user has already emptied out
// (`{ lanes: [] }`) is a deliberate, distinct state and is left alone: it
// would be surprising for lanes the user removed to reappear on reload.
export function normalizeKanbanBoard(value) {
  if (!isRecord(value) || value.lanes === undefined) return createDefaultKanbanBoard()
  const lanes = Array.isArray(value.lanes) ? value.lanes.map(normalizeLane).filter(Boolean) : []
  return { lanes }
}

export function kanbanBoardLabel(board) {
  const lanes = Array.isArray(board?.lanes) ? board.lanes : []
  const taskCount = lanes.reduce(
    (sum, lane) => sum + (Array.isArray(lane?.tasks) ? lane.tasks.length : 0),
    0,
  )
  return `Kanban board, ${lanes.length} lane${lanes.length === 1 ? '' : 's'}, ${taskCount} task${taskCount === 1 ? '' : 's'}`
}
