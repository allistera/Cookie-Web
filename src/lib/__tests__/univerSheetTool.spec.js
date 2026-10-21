import { CommandType } from '@univerjs/presets'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isSnapshotMutation, UniverSheetTool } from '../univerSheetTool'

afterEach(() => vi.unstubAllGlobals())

describe('spreadsheet tool lifecycle', () => {
  it('keeps the original data when no workbook is mounted', async () => {
    const data = {
      content: [
        ['Name', 'Total'],
        ['Example', '12'],
      ],
    }
    const tool = new UniverSheetTool({ data })
    expect(await tool.save()).toEqual(data)
    expect(UniverSheetTool.toolbox.title).toBe('Table')
    tool.destroy()
  })

  it('returns an empty initial snapshot when no data is supplied', async () => {
    const tool = new UniverSheetTool({})
    expect(await tool.save()).toEqual({})
    tool.destroy()
  })

  it('coalesces mutations into one document change per animation frame', () => {
    let frame
    const raf = vi.fn((callback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', raf)
    const onChange = vi.fn()
    const tool = new UniverSheetTool({ config: { onChange } })
    tool.scheduleDocumentSave()
    tool.scheduleDocumentSave()
    expect(raf).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
    frame()
    expect(onChange).toHaveBeenCalledOnce()
    tool.scheduleDocumentSave()
    expect(raf).toHaveBeenCalledTimes(2)
    frame()
    expect(onChange).toHaveBeenCalledTimes(2)
    tool.destroy()
  })

  it('waits for formula calculation before saving the live workbook', async () => {
    const tool = new UniverSheetTool({})
    let settle
    const workbook = { id: 'sheet', sheets: {} }
    const save = vi.fn(() => workbook)
    tool.univerAPI = { getActiveWorkbook: () => ({ save }) }
    tool.calculating = true
    tool.calculationSettled = new Promise((resolve) => {
      settle = resolve
    })
    const pending = tool.save()
    expect(save).not.toHaveBeenCalled()
    tool.calculating = false
    settle()
    expect(await pending).toEqual({ workbook })
    expect(save).toHaveBeenCalledOnce()
  })

  it('keeps prior data when the mounted API has no active workbook', async () => {
    const tool = new UniverSheetTool({ data: { content: [['Keep me']] } })
    tool.univerAPI = { getActiveWorkbook: () => null }
    expect(await tool.save()).toEqual({ content: [['Keep me']] })
  })

  it('disposes listeners, calculation subscriptions, theme observer and pending changes', () => {
    const tool = new UniverSheetTool({})
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const deferred = vi.fn()
    const observer = { disconnect: vi.fn() }
    const command = { dispose: vi.fn() }
    const formula = { dispose: vi.fn() }
    const univer = { dispose: vi.fn() }
    const api = { dispose: vi.fn() }
    tool.cancelDeferredMount = deferred
    tool.changeFrame = 42
    tool.themeObserver = observer
    tool.commandListener = command
    tool.formulaDisposables = [formula]
    tool.univer = univer
    tool.univerAPI = api
    tool.destroy()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42)
    expect(deferred).toHaveBeenCalledOnce()
    for (const resource of [command, formula, univer, api])
      expect(resource.dispose).toHaveBeenCalledOnce()
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(tool.univerAPI).toBeNull()
    expect(tool.formulaDisposables).toEqual([])
    tool.destroy()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42)
    expect(api.dispose).toHaveBeenCalledOnce()
  })
})

describe('isSnapshotMutation', () => {
  it('treats a mutation as a document change', () => {
    const command = { id: 'sheet.mutation.set-range-values', type: CommandType.MUTATION }
    expect(isSnapshotMutation(command, CommandType)).toBe(true)
  })

  // Selection moves and scrolling fire constantly and never change the saved
  // workbook, so they must not trigger an autosave.
  it('ignores operations and plain commands', () => {
    const selection = { id: 'sheet.operation.set-selections', type: CommandType.OPERATION }
    const command = { id: 'sheet.command.set-range-values', type: CommandType.COMMAND }
    expect(isSnapshotMutation(selection, CommandType)).toBe(false)
    expect(isSnapshotMutation(command, CommandType)).toBe(false)
    expect(isSnapshotMutation(undefined, CommandType)).toBe(false)
  })
})

describe('spreadsheet tool rendering', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('saves edits from the basic table and isolates cell navigation from the document', async () => {
    const onChange = vi.fn()
    const tool = new UniverSheetTool({ data: { content: [['Original']] }, config: { onChange } })
    const parent = document.createElement('div')
    const keydown = vi.fn()
    parent.addEventListener('keydown', keydown)
    parent.append(tool.render())
    document.body.append(parent)
    const cell = parent.querySelector('td')
    cell.textContent = 'Edited <value>'
    cell.dispatchEvent(new Event('input', { bubbles: true }))
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(await tool.save()).toEqual({ content: [['Edited &lt;value&gt;']] })
    expect(onChange).toHaveBeenCalledOnce()
    expect(keydown).not.toHaveBeenCalled()
    tool.destroy()
  })

  it('promotes a basic table through the spreadsheet action', async () => {
    const tool = new UniverSheetTool({ data: { content: [['Keep']] } })
    const mount = vi.spyOn(tool, 'mountUniver').mockResolvedValue()
    const root = tool.render()
    document.body.append(root)
    const upgrade = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === 'Open spreadsheet',
    )
    upgrade.click()
    expect(mount).toHaveBeenCalledExactlyOnceWith(root.querySelector('.basic-table-editor'))
    expect(upgrade.disabled).toBe(true)
    expect(await tool.save()).toEqual({ content: [['Keep']] })
    tool.destroy()
  })

  it('previews formula tables and mounts only after activation', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const tool = new UniverSheetTool({ data: { content: [['=1+1', 'Formula']] } })
    const mount = vi.spyOn(tool, 'mountUniver').mockResolvedValue()
    const root = tool.render()
    document.body.append(root)
    const preview = root.querySelector('.document-block-preview')
    expect(preview.textContent).toContain('=1+1 · Formula')
    expect(mount).not.toHaveBeenCalled()
    preview.click()
    preview.click()
    expect(mount).toHaveBeenCalledExactlyOnceWith(preview)
    tool.destroy()
  })

  it('previews workbook cell values without loading the runtime', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const tool = new UniverSheetTool({
      data: {
        workbook: {
          sheetOrder: ['s'],
          sheets: { s: { cellData: { 0: { 0: { v: 'Saved' }, 1: { v: 0 } } } } },
        },
      },
    })
    const mount = vi.spyOn(tool, 'mountUniver').mockResolvedValue()
    const root = tool.render()
    document.body.append(root)
    expect(root.textContent).toContain('Saved · 0')
    tool.destroy()
    root.querySelector('button').click()
    expect(mount).not.toHaveBeenCalled()
  })
})
