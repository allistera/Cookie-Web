import { describe, expect, it } from 'vitest'

import {
  getSlashSnippetCommands,
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
})
