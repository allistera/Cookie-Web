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

  it('keeps image files that the database serialization omits', () => {
    const elements = [
      { id: 'img-1', type: 'image', fileId: 'file-1' },
      { id: 'img-2', type: 'image', fileId: 'file-2', isDeleted: true },
    ]
    const files = {
      'file-1': { id: 'file-1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAA' },
      'file-2': { id: 'file-2', mimeType: 'image/png', dataURL: 'data:image/png;base64,BBB' },
      'file-3': { id: 'file-3', mimeType: 'image/png', dataURL: 'data:image/png;base64,CCC' },
    }
    // Mirrors Excalidraw: 'database' output has no files and no deleted elements.
    const serialize = vi.fn((els, appState) =>
      JSON.stringify({ elements: els.filter((el) => !el.isDeleted), appState, files: undefined }),
    )

    expect(serializeExcalidrawScene(elements, {}, files, serialize)).toEqual({
      elements: [elements[0]],
      appState: {},
      files: { 'file-1': files['file-1'] },
    })
  })

  it('describes the visible non-deleted element count', () => {
    expect(excalidrawDrawingLabel({ elements: [] })).toBe('Excalidraw drawing, empty')
    expect(
      excalidrawDrawingLabel({ elements: [{ id: 'one' }, { id: 'gone', isDeleted: true }] }),
    ).toBe('Excalidraw drawing, 1 element')
  })
})
