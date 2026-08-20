import { describe, expect, it } from 'vitest'

import { flattenDocumentsTree } from '../documentsTree'

const folder = (id, parent_id = null, title = id) => ({ id, parent_id, title })
const doc = (id, folder_id = null, title = id) => ({ id, folder_id, title })

describe('flattenDocumentsTree', () => {
  it('nests expanded folders and their documents by depth, root documents last', () => {
    const rows = flattenDocumentsTree(
      [folder('projects'), folder('kitchen', 'projects')],
      [doc('plan', 'kitchen'), doc('scratch')],
      new Set(['projects', 'kitchen']),
    )

    expect(rows.map((row) => [row.kind, row.item.id, row.depth])).toEqual([
      ['folder', 'projects', 0],
      ['folder', 'kitchen', 1],
      ['document', 'plan', 2],
      ['document', 'scratch', 0],
    ])
  })

  it('hides everything inside a collapsed folder', () => {
    const rows = flattenDocumentsTree(
      [folder('projects'), folder('kitchen', 'projects')],
      [doc('plan', 'kitchen'), doc('brief', 'projects')],
      new Set(),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].item.id).toBe('projects')
    expect(rows[0].expanded).toBe(false)
  })

  it('treats folders and documents with dangling parents as roots', () => {
    const rows = flattenDocumentsTree(
      [folder('orphan', 'deleted-elsewhere')],
      [doc('lost', 'also-deleted')],
      new Set(['orphan']),
    )

    expect(rows.map((row) => [row.kind, row.item.id, row.depth])).toEqual([
      ['folder', 'orphan', 0],
      ['document', 'lost', 0],
    ])
  })

  it('does not loop on a parent cycle', () => {
    const rows = flattenDocumentsTree([folder('a', 'b'), folder('b', 'a')], [], new Set(['a', 'b']))

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(2)
  })
})
