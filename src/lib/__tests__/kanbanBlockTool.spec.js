import { describe, expect, it } from 'vitest'

import { KanbanBlockTool } from '../kanbanBlockTool.js'

function setText(field, text) {
  field.textContent = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

// jsdom implements neither DataTransfer nor DragEvent (a known gap - drag-
// and-drop is unimplemented there), and getBoundingClientRect always
// returns an all-zero rect with no real layout engine behind it, so pixel-
// accurate "drop between these two cards" positioning can only be verified
// by the Playwright e2e test, which runs in a real browser. What's tested
// here is the wiring: dragstart/dragover/drop firing on plain Events with a
// hand-rolled dataTransfer stand-in reaches moveTask with the right ids.
function fakeDataTransfer() {
  const store = new Map()
  return {
    effectAllowed: null,
    dropEffect: null,
    setData: (type, value) => store.set(type, value),
    getData: (type) => store.get(type) ?? '',
  }
}

function fireDrag(target, type, { dataTransfer, clientY = 0, relatedTarget = null } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  event.dataTransfer = dataTransfer
  event.clientY = clientY
  event.relatedTarget = relatedTarget
  target.dispatchEvent(event)
  return event
}

describe('KanbanBlockTool', () => {
  it('renders the default Todo/In Progress/Done lanes for a new block', () => {
    const tool = new KanbanBlockTool({ data: {} })
    const el = tool.render()
    const titles = [...el.querySelectorAll('.kanban-lane__title')].map((node) => node.textContent)
    expect(titles).toEqual(['Todo', 'In Progress', 'Done'])
  })

  it('adds a lane and focuses its title field', () => {
    const tool = new KanbanBlockTool({ data: {} })
    document.body.append(tool.render())

    tool.wrapper.querySelector('.kanban-board__add-lane').click()

    const lanes = tool.wrapper.querySelectorAll('.kanban-lane')
    expect(lanes).toHaveLength(4)
    expect(document.activeElement).toBe(lanes[3].querySelector('.kanban-lane__title'))
    document.body.replaceChildren()
  })

  it('adds a task under a lane and focuses its title field', () => {
    const tool = new KanbanBlockTool({ data: {} })
    document.body.append(tool.render())

    tool.wrapper.querySelector('.kanban-lane__add-task').click()

    const task = tool.wrapper.querySelector('.kanban-task')
    expect(task).not.toBeNull()
    expect(document.activeElement).toBe(task.querySelector('.kanban-task__title'))
    document.body.replaceChildren()
  })

  it('focuses a lane whose id needs escaping in a selector', () => {
    const tool = new KanbanBlockTool({
      data: { lanes: [{ id: 'lane "1"\\x', title: 'Odd', tasks: [] }] },
    })
    document.body.append(tool.render())

    tool.focusRequest = { laneId: 'lane "1"\\x', field: 'lane' }
    expect(() => tool.renderBoard()).not.toThrow()
    expect(document.activeElement).toBe(tool.wrapper.querySelector('.kanban-lane__title'))
    document.body.replaceChildren()
  })

  it('saves edited lane/task text', () => {
    const tool = new KanbanBlockTool({ data: {} })
    const el = tool.render()
    el.querySelector('.kanban-lane__add-task').click()

    setText(el.querySelector('.kanban-lane__title'), 'Backlog')
    setText(el.querySelector('.kanban-task__title'), 'Write the kanban tool')
    setText(el.querySelector('.kanban-task__description'), 'Title + description only, for now.')

    const saved = tool.save()
    expect(saved.lanes[0].title).toBe('Backlog')
    expect(saved.lanes[0].tasks).toEqual([
      {
        id: expect.any(String),
        title: 'Write the kanban tool',
        description: 'Title + description only, for now.',
      },
    ])
  })

  it('deletes a task and a lane', () => {
    const tool = new KanbanBlockTool({ data: {} })
    const el = tool.render()
    el.querySelector('.kanban-lane__add-task').click()
    expect(el.querySelectorAll('.kanban-task')).toHaveLength(1)

    el.querySelector('.kanban-task__delete').click()
    expect(el.querySelectorAll('.kanban-task')).toHaveLength(0)

    el.querySelector('.kanban-lane__delete').click()
    expect(el.querySelectorAll('.kanban-lane')).toHaveLength(2)
    expect(tool.save().lanes).toHaveLength(2)
  })

  it('keeps Enter inside the title field instead of letting it bubble to Editor.js', () => {
    const tool = new KanbanBlockTool({ data: {} })
    const el = tool.render()
    el.querySelector('.kanban-lane__add-task').click()
    const title = el.querySelector('.kanban-task__title')
    const description = el.querySelector('.kanban-task__description')
    document.body.append(el)
    title.focus()

    // Listening on an ancestor of the block wrapper (not the wrapper
    // itself, where the tool's own guard is attached) is what actually
    // proves stopPropagation ran - Editor.js's own Enter handler sits above
    // the block wrapper the same way.
    let bubbled = false
    document.body.addEventListener('keydown', () => {
      bubbled = true
    })
    title.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )

    expect(bubbled).toBe(false)
    expect(document.activeElement).toBe(description)
    document.body.replaceChildren()
  })

  it('moveTask moves a task into another lane, appended by default', () => {
    const tool = new KanbanBlockTool({ data: {} })
    tool.render()
    const [todo, inProgress] = tool.data.lanes
    todo.tasks.push(
      { id: 'task-1', title: 'A', description: '' },
      { id: 'task-2', title: 'B', description: '' },
    )

    tool.moveTask('task-1', inProgress, null)

    expect(todo.tasks.map((t) => t.id)).toEqual(['task-2'])
    expect(inProgress.tasks.map((t) => t.id)).toEqual(['task-1'])
  })

  it('moveTask inserts before a given task, including reordering within the same lane', () => {
    const tool = new KanbanBlockTool({ data: {} })
    tool.render()
    const [todo] = tool.data.lanes
    todo.tasks.push(
      { id: 'task-1', title: 'A', description: '' },
      { id: 'task-2', title: 'B', description: '' },
      { id: 'task-3', title: 'C', description: '' },
    )

    tool.moveTask('task-3', todo, 'task-1')

    expect(todo.tasks.map((t) => t.id)).toEqual(['task-3', 'task-1', 'task-2'])
  })

  it('moveTask is a no-op for an unknown task id', () => {
    const tool = new KanbanBlockTool({ data: {} })
    tool.render()
    const [todo] = tool.data.lanes
    todo.tasks.push({ id: 'task-1', title: 'A', description: '' })

    tool.moveTask('does-not-exist', todo, null)

    expect(todo.tasks.map((t) => t.id)).toEqual(['task-1'])
  })

  it('drags a task card from one lane and drops it in another', () => {
    const tool = new KanbanBlockTool({ data: {} })
    const el = tool.render()
    el.querySelector('.kanban-lane__add-task').click()
    setText(el.querySelector('.kanban-task__title'), 'Ship it')
    const lanes = el.querySelectorAll('.kanban-lane')
    const card = lanes[0].querySelector('.kanban-task')
    const targetTasksEl = lanes[1].querySelector('.kanban-lane__tasks')

    const dataTransfer = fakeDataTransfer()
    fireDrag(card, 'dragstart', { dataTransfer })
    expect(tool.dragTaskId).toBe(card.dataset.taskId)
    expect(dataTransfer.getData('text/plain')).toBe(card.dataset.taskId)

    // The target lane starts with zero tasks, so taskAfterPoint has no
    // candidates and resolves to "insert at the end" regardless of clientY -
    // see the comment on fireDrag/fakeDataTransfer above for why
    // pixel-accurate mid-list positioning isn't exercised here.
    fireDrag(targetTasksEl, 'dragover', { dataTransfer, clientY: -1 })
    fireDrag(targetTasksEl, 'drop', { dataTransfer })
    fireDrag(card, 'dragend')

    expect(tool.save().lanes[0].tasks).toHaveLength(0)
    expect(tool.save().lanes[1].tasks.map((t) => t.title)).toEqual(['Ship it'])
    expect(tool.dragTaskId).toBeNull()
  })

  it('ignores dragover/drop on a lane when no task is being dragged', () => {
    const tool = new KanbanBlockTool({ data: {} })
    const el = tool.render()
    el.querySelector('.kanban-lane__add-task').click()
    const lanes = el.querySelectorAll('.kanban-lane')
    const targetTasksEl = lanes[1].querySelector('.kanban-lane__tasks')

    const event = fireDrag(targetTasksEl, 'dragover', { dataTransfer: fakeDataTransfer() })
    expect(event.defaultPrevented).toBe(false)
    fireDrag(targetTasksEl, 'drop', { dataTransfer: fakeDataTransfer() })

    expect(tool.save().lanes[0].tasks).toHaveLength(1)
    expect(tool.save().lanes[1].tasks).toHaveLength(0)
  })

  // Regression test: dropping a dragged card anywhere other than
  // .kanban-lane__tasks (e.g. a lane's own title field, or another block
  // entirely) used to leave the browser's native "insert dropped text"
  // action unprevented - it would splice the dragged task's raw id straight
  // into whatever contenteditable the drop landed on.
  it('prevents the browser default drop action anywhere outside the tasks list while dragging', () => {
    const tool = new KanbanBlockTool({ data: {} })
    const el = tool.render()
    el.querySelector('.kanban-lane__add-task').click()
    document.body.append(el)

    const card = el.querySelector('.kanban-task')
    const otherLaneTitle = el.querySelectorAll('.kanban-lane__title')[1]
    const dataTransfer = fakeDataTransfer()
    fireDrag(card, 'dragstart', { dataTransfer })

    const dragoverEvent = fireDrag(otherLaneTitle, 'dragover', { dataTransfer })
    expect(dragoverEvent.defaultPrevented).toBe(true)
    const dropEvent = fireDrag(otherLaneTitle, 'drop', { dataTransfer })
    expect(dropEvent.defaultPrevented).toBe(true)
    // Nothing moved - the drop landed outside any lane's own drop handler.
    // (jsdom doesn't implement the native "insert dropped text" action this
    // guards against - see the file-level comment above - so the only thing
    // verifiable here is that both events got their default prevented.)
    expect(tool.save().lanes[0].tasks).toHaveLength(1)
    expect(otherLaneTitle.textContent).toBe('In Progress')

    fireDrag(card, 'dragend')
    document.body.replaceChildren()

    // The document-wide guard is removed once the drag ends, so it doesn't
    // leak into unrelated drags elsewhere on the page.
    const afterDragEvent = fireDrag(document.body, 'dragover', { dataTransfer: fakeDataTransfer() })
    expect(afterDragEvent.defaultPrevented).toBe(false)
  })

  it('loads previously-saved board data unchanged', () => {
    const saved = {
      lanes: [
        {
          id: 'lane-1',
          title: 'Backlog',
          tasks: [{ id: 'task-1', title: 'Do it', description: '' }],
        },
      ],
    }
    const tool = new KanbanBlockTool({ data: saved })
    tool.render()
    expect(tool.save()).toEqual(saved)
  })
})
