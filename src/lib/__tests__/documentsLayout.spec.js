import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStoredLayout, saveLayout } from '../documentsLayout'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('documentsLayout', () => {
  it('defaults to grid', () => {
    expect(getStoredLayout()).toBe('grid')
  })
  it('round-trips list', () => {
    saveLayout('list')
    expect(localStorage.getItem('cookie-documents-layout')).toBe('list')
    expect(getStoredLayout()).toBe('list')
  })
  it('ignores garbage', () => {
    localStorage.setItem('cookie-documents-layout', 'columns')
    expect(getStoredLayout()).toBe('grid')
  })
  it('survives a throwing storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveLayout('list')).not.toThrow()
  })
})
