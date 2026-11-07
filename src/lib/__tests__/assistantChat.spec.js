import { afterEach, describe, expect, it, vi } from 'vitest'

import { SEARCH_API_URL } from '../apiWorkers'

import {
  MAX_LISTED_EMAILS,
  MAX_SOURCES,
  isEmailList,
  loadListedEmails,
  mailSourcesOf,
  mergeSources,
  readAssistantEvents,
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

describe('readAssistantEvents', () => {
  function body(parts) {
    const encoder = new TextEncoder()
    return new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part))
        controller.close()
      },
    })
  }

  it('parses events however the bytes were chunked and stops when asked', async () => {
    const seen = []
    await readAssistantEvents(
      body(['data: {"type":"token","text":"a"}\n\ndata: {"type":"tok', 'en","text":"b"}\n\n']),
      (event) => {
        seen.push(event)
      },
    )
    expect(seen).toEqual([
      { type: 'token', text: 'a' },
      { type: 'token', text: 'b' },
    ])

    const stopped = []
    await readAssistantEvents(
      body(['data: {"type":"token","text":"a"}\n\ndata: {"type":"done"}\n\n']),
      (event) => {
        stopped.push(event)
        return false
      },
    )
    expect(stopped).toEqual([{ type: 'token', text: 'a' }])
  })

  it('rejects a response without a body', async () => {
    await expect(readAssistantEvents(undefined, () => {})).rejects.toThrow(
      'Assistant stream unavailable',
    )
  })
})

describe('isEmailList and mailSourcesOf', () => {
  const mail = (id) => ({ index: 'messages', id, title: id })
  const doc = { index: 'documents', id: 'd1', title: 'Plan' }

  it('recognises a numbered or bulleted answer that cites two or more emails', () => {
    expect(
      isEmailList('Here they are:\n1. **Vercel** failed\n2. **Supabase** approval', [
        mail('a'),
        mail('b'),
      ]),
    ).toBe(true)
    expect(isEmailList('- one\n- two', [mail('a'), doc, mail('b')])).toBe(true)
  })

  it('leaves prose and single-email answers in the drawer', () => {
    expect(
      isEmailList('**Vercel** sent one email about a failed deploy.', [mail('a'), mail('b')]),
    ).toBe(false)
    expect(isEmailList('1. **Vercel** failed\n2. again', [mail('a')])).toBe(false)
    expect(isEmailList('1. a\n2. b', [doc, { index: 'task_items', id: 't' }])).toBe(false)
    expect(isEmailList('', [])).toBe(false)
  })

  it('picks the mail sources with an id', () => {
    expect(mailSourcesOf([mail('a'), doc, { index: 'messages', id: '' }])).toEqual([mail('a')])
    expect(mailSourcesOf(undefined)).toEqual([])
  })
})

describe('loadListedEmails', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks the search Worker for the rows by id, capped, and returns them', async () => {
    const emails = [{ id: 'b' }, { id: 'a' }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emails }) }))
    const ids = Array.from({ length: MAX_LISTED_EMAILS + 2 }, (_, i) => `id-${i}`)
    const signal = new AbortController().signal
    await expect(loadListedEmails(ids, { Authorization: 'Bearer t' }, signal)).resolves.toEqual(
      emails,
    )
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(
      `${SEARCH_API_URL}/search?ids=${encodeURIComponent(ids.slice(0, MAX_LISTED_EMAILS).join(','))}`,
    )
    expect(init).toEqual({ headers: { Authorization: 'Bearer t' }, signal })
  })

  it('throws on a failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(loadListedEmails(['a'], {}, undefined)).rejects.toThrow('responded 503')
  })
})
