import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentContentKey, requestDocumentChat } from '../documentAi'
import { AI_API_URL } from '../apiWorkers'

afterEach(() => vi.unstubAllGlobals())

describe('document AI requests', () => {
  it('compares content while ignoring generated block IDs', () => {
    const document = {
      title: 'Notes',
      blocks: [
        { id: 'first', type: 'paragraph', data: { text: 'Hi' }, tunes: { alignment: 'left' } },
      ],
    }
    expect(documentContentKey(null)).toBe('null')
    expect(documentContentKey(document)).toBe(
      documentContentKey({ ...document, blocks: [{ ...document.blocks[0], id: 'second' }] }),
    )
    expect(documentContentKey({ ...document, title: 'Changed' })).not.toBe(
      documentContentKey(document),
    )
    expect(
      documentContentKey({
        ...document,
        blocks: [{ ...document.blocks[0], data: { text: 'Changed' } }],
      }),
    ).not.toBe(documentContentKey(document))
  })

  it.each([
    { reply: 'Done', proposal: null },
    { reply: 'Suggested edits', proposal: { title: 'Updated', blocks: [] } },
  ])('sends context and accepts a valid response: %j', async (result) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const store = { authHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }) }
    const body = {
      instruction: 'Help',
      document: { title: 'Notes', blocks: [] },
      history: [],
      conversationId: 'conversation-1',
    }
    expect(await requestDocumentChat(store, { ...body, signal: controller.signal })).toEqual(result)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${AI_API_URL}/document-chat`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual(body)
    expect(options.headers).toEqual({ Authorization: 'Bearer test-token' })
    controller.abort()
    expect(options.signal.aborted).toBe(true)
  })

  it.each([
    null,
    {},
    { reply: 123, proposal: null },
    { reply: 'Hi' },
    { reply: 'Hi', proposal: {} },
    { reply: 'Hi', proposal: { title: 42, blocks: [] } },
    { reply: 'Hi', proposal: { title: 'Title', blocks: {} } },
  ])('rejects an invalid AI response: %j', async (result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => result }))
    await expect(
      requestDocumentChat(
        { authHeaders: async () => ({}) },
        { instruction: 'Help', signal: new AbortController().signal },
      ),
    ).rejects.toThrow('AI returned an invalid response')
  })

  it('rejects oversized UTF-8 input before authentication or network access', async () => {
    const store = { authHeaders: vi.fn() }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestDocumentChat(store, { instruction: '文'.repeat(400_000) })).rejects.toThrow(
      'This document is too large',
    )
    expect(store.authHeaders).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
