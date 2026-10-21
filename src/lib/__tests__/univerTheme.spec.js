import { afterEach, describe, expect, it } from 'vitest'
import { buildUniverTheme } from '../univerTheme'

afterEach(() => document.documentElement.style.removeProperty('--accent'))

describe('spreadsheet theme', () => {
  it('uses the app fallback accent and preserves unrelated theme values', () => {
    const defaults = { primary: { 500: '#000000' }, gray: { 500: '#888888' }, white: '#FFFFFF' }
    const theme = buildUniverTheme(defaults)
    expect(theme.primary[500]).toBe('#5e6ad2')
    expect(theme.primary[50]).toBe('#F5F6FC')
    expect(theme.primary[900]).toBe('#242850')
    expect(theme.gray).toBe(defaults.gray)
    expect(theme.white).toBe(defaults.white)
    expect(defaults.primary).toEqual({ 500: '#000000' })
    expect(Object.keys(theme.primary)).toHaveLength(10)
  })

  it.each(['#123', '#112233'])('derives the same ramp from accent %s', (accent) => {
    document.documentElement.style.setProperty('--accent', ` ${accent} `)
    const { primary } = buildUniverTheme({})
    expect(primary[500]).toBe(accent)
    expect(primary[400]).toBe('#4F5B68')
    expect(primary[600]).toBe('#0F1D2C')
  })
})
