import { beforeEach, describe, expect, it } from 'vitest'
import { TASKS_RAIL_STORAGE_KEY, useTasksRail } from '../useTasksRail'

beforeEach(() => {
  localStorage.clear()
  useTasksRail().reset()
})

describe('useTasksRail', () => {
  it('is closed by default', () => {
    expect(useTasksRail().isOpen.value).toBe(false)
  })

  it('shares one state and remembers it in this browser', () => {
    useTasksRail().toggle()

    expect(useTasksRail().isOpen.value).toBe(true)
    expect(localStorage.getItem(TASKS_RAIL_STORAGE_KEY)).toBe('1')

    useTasksRail().setOpen(false)
    expect(useTasksRail().isOpen.value).toBe(false)
    expect(localStorage.getItem(TASKS_RAIL_STORAGE_KEY)).toBeNull()
  })

  it('restores an open rail on the next load', () => {
    localStorage.setItem(TASKS_RAIL_STORAGE_KEY, '1')
    useTasksRail().reset()
    expect(useTasksRail().isOpen.value).toBe(true)
  })
})
