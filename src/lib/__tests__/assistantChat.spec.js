import { describe, expect, it } from 'vitest'

import {
  MAX_SOURCES,
  mergeSources,
  searchingLabel,
  sourceIcon,
  trimConversation,
} from '../assistantChat'

const user = (content) => ({ role: 'user', content })
const assistant = (content) => ({ role: 'assistant', content })
const tool = (content) => ({ role: 'tool', tool_call_id: 'c', content })

describe('trimConversation', () => {
  it('leaves a short conversation alone', () => {
    const messages = [user('a'), assistant('b'), user('c')]
    expect(trimConversation(messages, 5)).toEqual(messages)
  })

  it('drops the oldest messages and then any orphaned replies or tool results', () => {
    const messages = [user('q1'), assistant(null), tool('r1'), assistant('a1'), user('q2')]
    expect(trimConversation(messages, 4)).toEqual([user('q2')])
    expect(trimConversation(messages, 5)).toEqual(messages)
  })

  it('returns nothing when no question survives the cut', () => {
    expect(trimConversation([user('q'), assistant('a')], 1)).toEqual([])
  })
})

describe('searchingLabel and sourceIcon', () => {
  it('name each index in the person’s words and fall back for unknown ones', () => {
    expect(searchingLabel('messages')).toBe('Searching mail…')
    expect(searchingLabel('documents')).toBe('Searching documents…')
    expect(searchingLabel('task_items')).toBe('Searching tasks…')
    expect(searchingLabel('')).toBe('Searching…')
    expect(sourceIcon({ index: 'messages' })).toBe('mail')
    expect(sourceIcon({ index: 'documents' })).toBe('description')
    expect(sourceIcon({ index: 'task_items' })).toBe('task_alt')
    expect(sourceIcon({})).toBe('search')
  })
})

describe('mergeSources', () => {
  it('keeps each cited item once, in first-cited order, up to the cap', () => {
    const mail = { index: 'messages', id: 'm1', title: 'Roof' }
    const doc = { index: 'documents', id: 'm1', title: 'Plan' }
    expect(
      mergeSources([mail], [doc, mail, { index: 'messages', id: 'm2', title: 'Bill' }]),
    ).toEqual([mail, doc, { index: 'messages', id: 'm2', title: 'Bill' }])
    const many = Array.from({ length: MAX_SOURCES + 3 }, (_, i) => ({
      index: 'messages',
      id: String(i),
    }))
    expect(mergeSources([], many)).toHaveLength(MAX_SOURCES)
    expect(mergeSources([], undefined)).toEqual([])
  })
})
