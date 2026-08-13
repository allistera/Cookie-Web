import { describe, expect, it, vi } from 'vitest'

import {
  excalidrawDrawingLabel,
  normalizeExcalidrawScene,
  serializeExcalidrawScene,
} from '../excalidrawScene.js'

describe('Excalidraw scenes', () => {
  it('normalizes missing or malformed scene fields', () => {
    expect(normalizeExcalidrawScene(null)).toEqual({ elements: [], appState: {}, files: {} })
    expect(normalizeExcalidrawScene({ elements: 'nope', appState: [], files: null })).toEqual({
      elements: [],
      appState: {},
      files: {},
    })
  })

  it('uses Excalidraw database serialization before persistence', () => {
    const serialize = vi.fn(() =>
      JSON.stringify({ elements: [{ id: 'shape-1' }], appState: { zoom: 1 }, files: {} }),
    )

    expect(serializeExcalidrawScene([{ id: 'shape-1' }], { zoom: 1 }, {}, serialize)).toEqual({
      elements: [{ id: 'shape-1' }],
      appState: { zoom: 1 },
      files: {},
    })
    expect(serialize).toHaveBeenCalledWith([{ id: 'shape-1' }], { zoom: 1 }, {}, 'database')
  })

  it('describes the visible non-deleted element count', () => {
    expect(excalidrawDrawingLabel({ elements: [] })).toBe('Excalidraw drawing, empty')
    expect(
      excalidrawDrawingLabel({ elements: [{ id: 'one' }, { id: 'gone', isDeleted: true }] }),
    ).toBe('Excalidraw drawing, 1 element')
  })
})
