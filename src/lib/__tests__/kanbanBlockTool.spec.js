import { describe, expect, it } from 'vitest'

import { KanbanBlockTool } from '../kanbanBlockTool.js'

function setText(field, text) {
  field.textContent = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
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
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(bubbled).toBe(false)
    expect(document.activeElement).toBe(description)
    document.body.replaceChildren()
  })

  it('loads previously-saved board data unchanged', () => {
    const saved = {
      lanes: [
        { id: 'lane-1', title: 'Backlog', tasks: [{ id: 'task-1', title: 'Do it', description: '' }] },
      ],
    }
    const tool = new KanbanBlockTool({ data: saved })
    tool.render()
    expect(tool.save()).toEqual(saved)
  })
})
