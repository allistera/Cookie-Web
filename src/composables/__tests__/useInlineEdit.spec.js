import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useInlineEdit } from '../useInlineEdit'

describe('useInlineEdit', () => {
  it('seeds the draft from read() and enters edit mode', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: vi.fn() })

    await edit.start()

    expect(edit.editing.value).toBe(true)
    expect(edit.draft.value).toBe('Roof')
  })

  it('does not start when canEdit() is false', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: vi.fn(), canEdit: () => false })

    await edit.start()

    expect(edit.editing.value).toBe(false)
  })

  // Enter commits and unmounts the input, which fires blur, calling submit a
  // second time. Without the guard every edit is sent twice.
  it('writes once when submit is called twice', async () => {
    const write = vi.fn()
    const edit = useInlineEdit({ read: () => 'Roof', write })
    await edit.start()
    edit.draft.value = 'Roofing'

    await edit.submit()
    await edit.submit()

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('Roofing')
  })

  it('does not write when the value is unchanged', async () => {
    const write = vi.fn()
    const edit = useInlineEdit({ read: () => 'Roof', write })
    await edit.start()

    await edit.submit()

    expect(write).not.toHaveBeenCalled()
  })

  it('trims the draft before comparing and writing', async () => {
    const write = vi.fn()
    const edit = useInlineEdit({ read: () => 'Roof', write })
    await edit.start()
    edit.draft.value = '  Roof  '

    await edit.submit()

    expect(write).not.toHaveBeenCalled()
  })

  it('leaves edit mode even when write rejects', async () => {
    const edit = useInlineEdit({
      read: () => 'Roof',
      write: () => Promise.reject(new Error('no')),
    })
    await edit.start()
    edit.draft.value = 'Roofing'

    await expect(edit.submit()).rejects.toThrow('no')

    expect(edit.editing.value).toBe(false)
  })

  it('focuses and selects the input once mounted', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: vi.fn() })
    const focus = vi.fn()
    const select = vi.fn()
    edit.inputRef.value = { focus, select }

    await edit.start()
    await nextTick()

    expect(focus).toHaveBeenCalled()
    expect(select).toHaveBeenCalled()
  })

  it('focuses without selecting when selectAll is false', async () => {
    const edit = useInlineEdit({ read: () => 'Roof', write: vi.fn(), selectAll: false })
    const focus = vi.fn()
    const select = vi.fn()
    edit.inputRef.value = { focus, select }

    await edit.start()
    await nextTick()

    expect(focus).toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('reads the value fresh on each start rather than caching it', async () => {
    let name = 'Roof'
    const edit = useInlineEdit({ read: () => name, write: vi.fn() })

    await edit.start()
    expect(edit.draft.value).toBe('Roof')

    name = 'Renamed'
    await edit.submit()
    await edit.start()

    expect(edit.draft.value).toBe('Renamed')
  })
})
