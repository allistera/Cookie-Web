import { CommandType } from '@univerjs/presets'
import { describe, expect, it } from 'vitest'

import { isSnapshotMutation } from '../univerSheetTool'

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
