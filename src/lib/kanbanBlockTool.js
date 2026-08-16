import {
  createKanbanLane,
  createKanbanTask,
  kanbanBoardLabel,
  normalizeKanbanBoard,
} from './kanbanBoard'

const TOOLBOX_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2"/>
    <line x1="9" y1="4" x2="9" y2="20"/>
    <line x1="15" y1="4" x2="15" y2="20"/>
  </svg>`

const DELETE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`

// Keys Editor.js's own BlockEvents handler would otherwise intercept
// block-wide (splitting the block on Enter, merging it into the previous
// block on Backspace at the start of our first field). Stopped here so
// typing inside a lane/task field only ever edits that field's text - see
// the static `enableLineBreaks` getter below for the Enter half of this.
const GUARDED_KEYS = new Set(['Backspace', 'Delete', 'Enter'])

// A "/" menu block that turns a document section into a small Kanban board:
// a row of lanes (swimlanes), each holding title+description task cards.
// Plain DOM/vanilla JS, not a mounted Vue app - the board is simple enough
// that pulling in a component tree (and its lifecycle inside Editor.js,
// which owns and destroys this element itself) isn't worth it.
export class KanbanBlockTool {
  static get toolbox() {
    return { title: 'Kanban', icon: TOOLBOX_ICON }
  }

  // See GUARDED_KEYS - without this, pressing Enter inside a task/lane
  // field would ask Editor.js to split the Kanban block into two blocks.
  static get enableLineBreaks() {
    return true
  }

  constructor({ data }) {
    this.data = normalizeKanbanBoard(data)
    this.wrapper = null
    this.board = null
    this.focusRequest = null
  }

  render() {
    this.wrapper = document.createElement('div')
    this.wrapper.className = 'kanban-block'
    this.wrapper.setAttribute('role', 'region')
    this.wrapper.addEventListener('keydown', (event) => this.onKeydown(event))

    this.board = document.createElement('div')
    this.board.className = 'kanban-board'
    this.wrapper.append(this.board)

    const addLane = document.createElement('button')
    addLane.type = 'button'
    addLane.className = 'kanban-board__add-lane'
    addLane.textContent = '+ Add lane'
    addLane.addEventListener('click', () => this.addLane())
    this.wrapper.append(addLane)

    this.renderBoard()
    return this.wrapper
  }

  onKeydown(event) {
    if (!GUARDED_KEYS.has(event.key) || event.target?.contentEditable !== 'true') return
    event.stopPropagation()
    if (event.key !== 'Enter') return
    // Titles are single-line: Enter moves on instead of inserting a break.
    if (event.target.classList.contains('kanban-task__title')) {
      event.preventDefault()
      event.target.closest('.kanban-task')?.querySelector('.kanban-task__description')?.focus()
    } else if (event.target.classList.contains('kanban-lane__title')) {
      event.preventDefault()
      event.target.blur()
    }
  }

  addLane() {
    const lane = createKanbanLane('')
    this.data.lanes.push(lane)
    this.focusRequest = { laneId: lane.id, field: 'lane' }
    this.renderBoard()
  }

  removeLane(laneId) {
    this.data.lanes = this.data.lanes.filter((lane) => lane.id !== laneId)
    this.renderBoard()
  }

  addTask(lane) {
    const task = createKanbanTask()
    lane.tasks.push(task)
    this.focusRequest = { taskId: task.id, field: 'task' }
    this.renderBoard()
  }

  removeTask(lane, taskId) {
    lane.tasks = lane.tasks.filter((task) => task.id !== taskId)
    this.renderBoard()
  }

  renderBoard() {
    this.board.replaceChildren(...this.data.lanes.map((lane) => this.renderLane(lane)))
    this.wrapper.setAttribute('aria-label', kanbanBoardLabel(this.data))
    if (!this.focusRequest) return
    const { laneId, taskId } = this.focusRequest
    this.focusRequest = null
    const selector = laneId
      ? `.kanban-lane[data-lane-id="${laneId}"] > .kanban-lane__header .kanban-lane__title`
      : `.kanban-task[data-task-id="${taskId}"] .kanban-task__title`
    this.board.querySelector(selector)?.focus()
  }

  renderLane(lane) {
    const laneEl = document.createElement('div')
    laneEl.className = 'kanban-lane'
    laneEl.dataset.laneId = lane.id
    laneEl.setAttribute('role', 'group')
    laneEl.setAttribute('aria-label', lane.title || 'Untitled lane')

    const header = document.createElement('div')
    header.className = 'kanban-lane__header'
    header.append(
      this.editableField({
        className: 'kanban-lane__title',
        placeholder: 'Lane name',
        text: lane.title,
        singleLine: true,
        onInput: (text) => {
          lane.title = text
          laneEl.setAttribute('aria-label', text || 'Untitled lane')
        },
      }),
      this.iconButton('kanban-lane__delete', DELETE_ICON, 'Delete lane', () => this.removeLane(lane.id)),
    )
    laneEl.append(header)

    const tasksEl = document.createElement('div')
    tasksEl.className = 'kanban-lane__tasks'
    tasksEl.setAttribute('role', 'list')
    tasksEl.append(...lane.tasks.map((task) => this.renderTask(lane, task)))
    laneEl.append(tasksEl)

    const addTask = document.createElement('button')
    addTask.type = 'button'
    addTask.className = 'kanban-lane__add-task'
    addTask.textContent = '+ Add task'
    addTask.addEventListener('click', () => this.addTask(lane))
    laneEl.append(addTask)

    return laneEl
  }

  renderTask(lane, task) {
    const taskEl = document.createElement('div')
    taskEl.className = 'kanban-task'
    taskEl.dataset.taskId = task.id
    taskEl.setAttribute('role', 'listitem')

    const header = document.createElement('div')
    header.className = 'kanban-task__header'
    header.append(
      this.editableField({
        className: 'kanban-task__title',
        placeholder: 'Task title',
        text: task.title,
        singleLine: true,
        onInput: (text) => {
          task.title = text
        },
      }),
      this.iconButton('kanban-task__delete', DELETE_ICON, 'Delete task', () =>
        this.removeTask(lane, task.id),
      ),
    )
    taskEl.append(header)

    taskEl.append(
      this.editableField({
        className: 'kanban-task__description',
        placeholder: 'Description',
        text: task.description,
        onInput: (text) => {
          task.description = text
        },
      }),
    )

    return taskEl
  }

  editableField({ className, placeholder, text, singleLine, onInput }) {
    const field = document.createElement('div')
    field.className = className
    field.contentEditable = 'true'
    // Browsers make contenteditable elements keyboard-focusable implicitly,
    // but jsdom (and some assistive tech) only honors an explicit tabIndex.
    field.tabIndex = 0
    field.spellcheck = !singleLine
    field.dataset.placeholder = placeholder
    field.textContent = text
    field.addEventListener('input', () => onInput(field.textContent ?? ''))
    return field
  }

  iconButton(className, icon, label, onClick) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.innerHTML = icon
    button.setAttribute('aria-label', label)
    button.addEventListener('click', onClick)
    return button
  }

  save() {
    return this.data
  }

  destroy() {
    this.wrapper = null
    this.board = null
  }
}
