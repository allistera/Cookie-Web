import { describe, expect, it } from 'vitest'

import {
  getSlashSnippetCommands,
  getLegacySnippets,
  clearLegacySnippets,
  normalizeSnippetName,
  sanitizeStoredSnippets,
} from '../snippets.js'

describe('snippet helpers', () => {
  it('normalizes a human name into a safe slash trigger', () => {
    expect(normalizeSnippetName('  Hello World!  ')).toBe('hello-world')
    expect(normalizeSnippetName('')).toBe('')
  })

  it('keeps unique valid snippets and sanitizes their stored HTML', () => {
    expect(
      sanitizeStoredSnippets([
        {
          id: 'one',
          name: 'Hello World',
          html: '<p>Hello <strong>there</strong></p><script>alert(1)</script>',
        },
        { id: 'two', name: 'hello-world', html: '<p>Duplicate</p>' },
        { id: 'three', name: '', html: '<p>Missing name</p>' },
      ]),
    ).toEqual([{ id: 'one', name: 'hello-world', html: '<p>Hello <strong>there</strong></p>' }])
  })

  it('turns snippets into distinguishable slash-menu commands', () => {
    expect(
      getSlashSnippetCommands([{ id: 'one', name: 'hello-world', html: '<p>Hello</p>' }]),
    ).toEqual([
      {
        id: 'snippet:one',
        type: 'snippet',
        title: 'hello-world',
        hint: 'Snippet',
        icon: 'bookmark',
        keywords: 'hello-world',
        html: '<p>Hello</p>',
      },
    ])
  })

  it('reuses the commands for the same snippet array', () => {
    const snippets = [{ id: 'one', name: 'hello-world', html: '<p>Hello</p>' }]
    const commands = getSlashSnippetCommands(snippets)

    expect(getSlashSnippetCommands(snippets)).toBe(commands)
    expect(getSlashSnippetCommands([...snippets])).not.toBe(commands)
  })

  it('reads old unscoped snippets only for import and clears them when selected', () => {
    localStorage.setItem(
      'cookie-compose-snippets',
      JSON.stringify([
        {
          id: 'old',
          name: 'Old Trigger',
          html: '<p>Safe<script>alert(1)</script></p>',
        },
      ]),
    )
    expect(getLegacySnippets()).toEqual([{ id: 'old', name: 'old-trigger', html: '<p>Safe</p>' }])
    clearLegacySnippets()
    expect(localStorage.getItem('cookie-compose-snippets')).toBeNull()
  })
})
