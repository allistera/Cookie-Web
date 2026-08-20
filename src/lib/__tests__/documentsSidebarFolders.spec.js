import { describe, it, expect, beforeEach } from 'vitest'

import {
  getStoredExpandedFolderIds,
  saveExpandedFolderIds,
  sanitizeStoredFolderIds,
} from '../documentsSidebarFolders.js'

describe('documents sidebar expanded-folder storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns no expanded folders when nothing is stored', () => {
    expect(getStoredExpandedFolderIds()).toEqual([])
  })

  it('round-trips a saved set of folder ids', () => {
    saveExpandedFolderIds(new Set(['f-projects', 'f-kitchen']))

    expect(getStoredExpandedFolderIds()).toEqual(['f-projects', 'f-kitchen'])
    expect(JSON.parse(localStorage.getItem('cookie-documents-expanded-folders'))).toEqual([
      'f-projects',
      'f-kitchen',
    ])
  })

  it('treats garbage stored JSON as empty instead of throwing', () => {
    localStorage.setItem('cookie-documents-expanded-folders', 'not json')
    expect(getStoredExpandedFolderIds()).toEqual([])
  })

  it('sanitizeStoredFolderIds drops non-array input, blanks, and duplicates', () => {
    expect(sanitizeStoredFolderIds(null)).toEqual([])
    expect(sanitizeStoredFolderIds('f-projects')).toEqual([])
    expect(
      sanitizeStoredFolderIds(['f-projects', '', '  ', 'f-projects', 42, 'f-kitchen']),
    ).toEqual(['f-projects', '42', 'f-kitchen'])
  })

  it('caps the number of stored ids', () => {
    const many = Array.from({ length: 600 }, (_, i) => `f-${i}`)
    const cleaned = saveExpandedFolderIds(new Set(many))
    expect(cleaned).toHaveLength(500)
    expect(getStoredExpandedFolderIds()).toHaveLength(500)
  })
})
