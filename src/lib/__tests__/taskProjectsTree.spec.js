import { describe, expect, it } from 'vitest'

import { flattenProjectTree } from '../taskProjectsTree'

const project = (id, parentId = null, name = id) => ({ id, parentId, name })

describe('flattenProjectTree', () => {
  it('nests children under an expanded parent and marks depth', () => {
    const rows = flattenProjectTree(
      [project('work'), project('api', 'work'), project('home')],
      new Set(['work']),
    )

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      ['home', 0],
      ['work', 0],
      ['api', 1],
    ])
  })

  it('hides children of a collapsed parent without orphaning them', () => {
    const rows = flattenProjectTree([project('work'), project('api', 'work')], new Set())

    expect(rows.map((row) => row.item.id)).toEqual(['work'])
    expect(rows[0].hasChildren).toBe(true)
    expect(rows[0].expanded).toBe(false)
  })

  // A parent that no longer exists must not take its children down with it.
  it('surfaces a project whose parent does not resolve at the root', () => {
    const rows = flattenProjectTree([project('orphan', 'deleted-parent')], new Set())

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([['orphan', 0]])
  })

  // Two projects pointing at each other are reachable from no root at all.
  it('breaks a parent cycle by pulling a member up to the root', () => {
    const rows = flattenProjectTree([project('a', 'b'), project('b', 'a')], new Set(['a', 'b']))

    expect(rows).toHaveLength(2)
    expect(rows.some((row) => row.depth === 0)).toBe(true)
  })
})
