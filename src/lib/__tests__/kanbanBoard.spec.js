import { describe, expect, it } from 'vitest'

import {
  createDefaultKanbanBoard,
  kanbanBoardLabel,
  normalizeKanbanBoard,
} from '../kanbanBoard.js'

describe('Kanban boards', () => {
  it('defaults a brand new block to Todo/In Progress/Done', () => {
    const board = createDefaultKanbanBoard()
    expect(board.lanes.map((lane) => lane.title)).toEqual(['Todo', 'In Progress', 'Done'])
    expect(board.lanes.every((lane) => Array.isArray(lane.tasks) && lane.tasks.length === 0)).toBe(
      true,
    )
    expect(new Set(board.lanes.map((lane) => lane.id)).size).toBe(3)
  })

  it('normalizes missing/malformed data to the default board', () => {
    expect(normalizeKanbanBoard(null).lanes).toHaveLength(3)
    expect(normalizeKanbanBoard(undefined).lanes).toHaveLength(3)
    expect(normalizeKanbanBoard({}).lanes).toHaveLength(3)
  })

  it('respects a deliberately emptied board instead of re-adding default lanes', () => {
    expect(normalizeKanbanBoard({ lanes: [] })).toEqual({ lanes: [] })
  })

  it('drops malformed lanes/tasks and backfills missing ids', () => {
    const board = normalizeKanbanBoard({
      lanes: [
        'not a lane',
        {
          title: 'Todo',
          tasks: [42, { title: 'Write tests', description: 'Cover kanbanBoard.js' }],
        },
      ],
    })
    expect(board.lanes).toHaveLength(1)
    expect(board.lanes[0].id).toEqual(expect.any(String))
    expect(board.lanes[0].tasks).toEqual([
      { id: expect.any(String), title: 'Write tests', description: 'Cover kanbanBoard.js' },
    ])
  })

  it('coerces non-string titles/descriptions instead of throwing', () => {
    const board = normalizeKanbanBoard({
      lanes: [{ id: 'lane-1', title: 42, tasks: [{ id: 'task-1', title: null, description: [] }] }],
    })
    expect(board.lanes[0].title).toBe('')
    expect(board.lanes[0].tasks[0]).toEqual({ id: 'task-1', title: '', description: '' })
  })

  it('describes the lane and task counts', () => {
    expect(kanbanBoardLabel({ lanes: [] })).toBe('Kanban board, 0 lanes, 0 tasks')
    expect(
      kanbanBoardLabel({
        lanes: [
          { id: '1', title: 'Todo', tasks: [{ id: 'a' }] },
          { id: '2', title: 'Done', tasks: [] },
        ],
      }),
    ).toBe('Kanban board, 2 lanes, 1 task')
  })
})
