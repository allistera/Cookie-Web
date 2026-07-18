import { describe, it, expect } from 'vitest'

import { SLASH_COMMANDS, filterSlashCommands } from '../slashCommands.js'

describe('filterSlashCommands', () => {
  it('returns all commands for an empty query', () => {
    expect(filterSlashCommands('')).toEqual(SLASH_COMMANDS)
    expect(filterSlashCommands('  ')).toEqual(SLASH_COMMANDS)
  })

  it('includes a Generate Message command', () => {
    const generate = SLASH_COMMANDS.find((c) => c.id === 'generate')
    expect(generate.title).toBe('Generate Message')
  })

  it('matches by title', () => {
    expect(filterSlashCommands('head').map((c) => c.id)).toEqual(['heading'])
  })

  it('matches by keyword alias', () => {
    // "write" is a keyword of the generate command, not in its title.
    expect(filterSlashCommands('write').map((c) => c.id)).toEqual(['generate'])
    expect(filterSlashCommands('unordered').map((c) => c.id)).toEqual(['bullet'])
  })

  it('is case-insensitive and returns nothing for no match', () => {
    expect(filterSlashCommands('BOLD').map((c) => c.id)).toEqual(['bold'])
    expect(filterSlashCommands('zzz')).toEqual([])
  })
})
