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

  it('offers a code block command matched by title and aliases', () => {
    expect(filterSlashCommands('code').map((c) => c.id)).toEqual(['code'])
    expect(filterSlashCommands('monospace').map((c) => c.id)).toEqual(['code'])
  })

  it('is case-insensitive and returns nothing for no match', () => {
    expect(filterSlashCommands('BOLD').map((c) => c.id)).toEqual(['bold'])
    expect(filterSlashCommands('zzz')).toEqual([])
  })

  it('puts matching user snippets before built-in commands', () => {
    const commands = filterSlashCommands('hello', [
      { id: 'snippet:1', title: 'hello-world', keywords: 'hello-world' },
    ])

    expect(commands.map((command) => command.id)).toEqual(['snippet:1'])
  })
})
