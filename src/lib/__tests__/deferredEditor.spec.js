import { afterEach, describe, expect, it, vi } from 'vitest'
import { UniverSheetTool } from '../univerSheetTool'
import { ExcalidrawBlockTool } from '../excalidrawBlockTool'
import { deferEditorMount, editorPreview } from '../deferredEditor'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('deferred editor activation', () => {
  it('does not mount offscreen blocks and activates a visible block only once', () => {
    let intersect
    const disconnect = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback) {
          intersect = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    const wrapper = document.createElement('div')
    const preview = editorPreview('Table', ['<script>untrusted</script>'])
    wrapper.append(preview)
    document.body.append(wrapper)
    const mount = vi.fn()
    const dispose = deferEditorMount(wrapper, preview, mount)
    expect(mount).not.toHaveBeenCalled()
    expect(preview.querySelector('script')).toBeNull()
    intersect([{ isIntersecting: true }])
    preview.click()
    expect(mount).toHaveBeenCalledTimes(1)
    dispose()
    expect(disconnect).toHaveBeenCalled()
  })

  it('supports click activation without an observer and cancels on teardown', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const wrapper = document.createElement('div')
    const preview = editorPreview('Drawing')
    wrapper.append(preview)
    document.body.append(wrapper)
    const mount = vi.fn()
    const dispose = deferEditorMount(wrapper, preview, mount)
    dispose()
    preview.click()
    expect(mount).not.toHaveBeenCalled()
    deferEditorMount(wrapper, preview, mount)
    preview.click()
    expect(mount).toHaveBeenCalledTimes(1)
  })
})

it('preserves offscreen editor snapshots when another block saves', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const data = { content: [['Keep this formula', '=1+1']], withHeadings: true }
  const sheet = new UniverSheetTool({ data })
  document.body.append(sheet.render())
  expect(sheet.univerAPI).toBeNull()
  expect(await sheet.save()).toEqual(data)
  const drawing = new ExcalidrawBlockTool({ data: { elements: [], appState: {}, files: {} } })
  const snapshot = structuredClone(drawing.data)
  document.body.append(drawing.render())
  expect(drawing.root).toBeNull()
  expect(drawing.save()).toEqual(snapshot)
  sheet.destroy()
  drawing.destroy()
})
