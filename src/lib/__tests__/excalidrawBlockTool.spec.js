import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExcalidrawBlockTool } from '../excalidrawBlockTool'

describe('drawing tool lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('batches save notifications into one animation frame and allows subsequent saves', () => {
    let runFrame
    const request = vi.fn((callback) => {
      runFrame = callback
      return 12
    })
    vi.stubGlobal('requestAnimationFrame', request)
    const onChange = vi.fn()
    const tool = new ExcalidrawBlockTool({ data: {}, config: { onChange } })
    tool.scheduleDocumentSave()
    tool.scheduleDocumentSave()
    expect(request).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    runFrame()
    expect(onChange).toHaveBeenCalledTimes(1)
    tool.scheduleDocumentSave()
    runFrame()
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(tool.changeFrame).toBeNull()
  })

  it('allows saving without a change callback', () => {
    let runFrame
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      runFrame = callback
      return 1
    })
    const tool = new ExcalidrawBlockTool({ data: {} })
    tool.scheduleDocumentSave()
    expect(() => runFrame()).not.toThrow()
    expect(tool.changeFrame).toBeNull()
  })

  it('cancels pending saves and releases its mounted editor on destruction', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 42),
    )
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const tool = new ExcalidrawBlockTool({ data: {} })
    const unmount = vi.fn()
    const cancelDeferred = vi.fn()
    tool.root = { unmount }
    tool.cancelDeferredMount = cancelDeferred
    tool.wrapper = document.createElement('div')
    tool.scheduleDocumentSave()
    tool.destroy()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42)
    expect(unmount).toHaveBeenCalledTimes(1)
    expect(cancelDeferred).toHaveBeenCalledTimes(1)
    expect(tool.root).toBeNull()
    expect(tool.wrapper).toBeNull()
    expect(tool.changeFrame).toBeNull()
    tool.destroy()
    expect(unmount).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('exposes its toolbox and safely destroys a never-rendered drawing', () => {
    expect(ExcalidrawBlockTool.toolbox.title).toBe('Excalidraw')
    expect(ExcalidrawBlockTool.toolbox.icon).toContain('<svg')
    const tool = new ExcalidrawBlockTool({ data: {} })
    expect(() => tool.updateLabel()).not.toThrow()
    expect(() => tool.destroy()).not.toThrow()
    expect(tool.save().elements).toEqual([])
  })
})
