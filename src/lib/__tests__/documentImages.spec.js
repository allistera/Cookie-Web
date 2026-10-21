import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDocumentImageCache,
  isPrivateDocumentImage,
  resolveDocumentImageUrl,
  withPrivateDocumentImages,
} from '../documentImages'

const PRIVATE = 'https://abc.private.blob.vercel-storage.com/documents/u1/pic.png'
const getHeaders = async () => ({ Authorization: 'Bearer test' })

function signedResponse(url, expiresAt) {
  return { ok: true, json: async () => ({ url, expiresAt }) }
}

describe('isPrivateDocumentImage', () => {
  it('matches only https URLs in a private Blob store', () => {
    expect(isPrivateDocumentImage(PRIVATE)).toBe(true)
    expect(isPrivateDocumentImage('https://abc.public.blob.vercel-storage.com/x.png')).toBe(false)
    expect(isPrivateDocumentImage('data:image/png;base64,AAAA')).toBe(false)
    expect(isPrivateDocumentImage('not a url')).toBe(false)
    expect(isPrivateDocumentImage(undefined)).toBe(false)
  })
})

describe('resolveDocumentImageUrl', () => {
  beforeEach(() => clearDocumentImageCache())
  afterEach(() => vi.unstubAllGlobals())

  it('returns ordinary URLs unchanged without a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await resolveDocumentImageUrl('data:image/png;base64,AAAA', { getHeaders })).toBe(
      'data:image/png;base64,AAAA',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the tasks Worker for a signed link and reuses it until near expiry', async () => {
    let clock = Date.parse('2026-09-27T09:00:00Z')
    const now = () => clock
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signedResponse('https://signed/1', '2026-09-27T10:00:00Z'))
      .mockResolvedValueOnce(signedResponse('https://signed/2', '2026-09-27T11:00:00Z'))
    vi.stubGlobal('fetch', fetchMock)

    expect(await resolveDocumentImageUrl(PRIVATE, { now, getHeaders })).toBe('https://signed/1')
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://tasks-api.infinitywave.online/tasks/document-image?url=${encodeURIComponent(PRIVATE)}`,
    )
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer test' })

    clock = Date.parse('2026-09-27T09:30:00Z')
    expect(await resolveDocumentImageUrl(PRIVATE, { now, getHeaders })).toBe('https://signed/1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clock = Date.parse('2026-09-27T09:59:30Z')
    expect(await resolveDocumentImageUrl(PRIVATE, { now, getHeaders })).toBe('https://signed/2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares a pending signed-link request between concurrent callers', async () => {
    let complete
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const first = resolveDocumentImageUrl(PRIVATE, { getHeaders })
    const second = resolveDocumentImageUrl(PRIVATE, { getHeaders })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    complete(signedResponse('https://signed/shared', '2099-01-01T00:00:00Z'))
    expect(await Promise.all([first, second])).toEqual([
      'https://signed/shared',
      'https://signed/shared',
    ])
  })

  it('does not let an old failed request evict a replacement cache entry', async () => {
    let fail
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject
          }),
      )
      .mockResolvedValueOnce(signedResponse('https://signed/replacement', '2099-01-01T00:00:00Z'))
    vi.stubGlobal('fetch', fetchMock)
    const old = resolveDocumentImageUrl(PRIVATE, { getHeaders })
    const oldFailure = old.catch((error) => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    clearDocumentImageCache()
    expect(await resolveDocumentImageUrl(PRIVATE, { getHeaders })).toBe(
      'https://signed/replacement',
    )
    fail(new Error('old request failed'))
    expect(await oldFailure).toEqual(new Error('old request failed'))
    expect(await resolveDocumentImageUrl(PRIVATE, { getHeaders })).toBe(
      'https://signed/replacement',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('allows retrying after header acquisition fails', async () => {
    const headers = vi
      .fn()
      .mockRejectedValueOnce(new Error('session expired'))
      .mockResolvedValueOnce({ Authorization: 'Bearer renewed' })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(signedResponse('https://signed/retry', '2099-01-01T00:00:00Z'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveDocumentImageUrl(PRIVATE, { getHeaders: headers })).rejects.toThrow(
      'session expired',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await resolveDocumentImageUrl(PRIVATE, { getHeaders: headers })).toBe(
      'https://signed/retry',
    )
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer renewed' })
  })

  it('does not cache a failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(signedResponse('https://signed/ok', '2099-01-01T00:00:00Z'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveDocumentImageUrl(PRIVATE, { getHeaders })).rejects.toThrow('404')
    expect(await resolveDocumentImageUrl(PRIVATE, { getHeaders })).toBe('https://signed/ok')
  })
})

describe('withPrivateDocumentImages', () => {
  // Mirrors @editorjs/image: the constructor assigns this.image for saved
  // blocks, and the setter stores the file in this._data and fills the UI.
  class FakeImageTool {
    constructor({ data } = {}) {
      this._data = {}
      this.filled = []
      this.ui = {
        nodes: { imageContainer: document.createElement('div') },
        fillImage: (url) => this.filled.push(url),
      }
      this.image = data?.file
    }

    set image(file) {
      this._data.file = file || { url: '' }
      if (file?.url) this.ui.fillImage(file.url)
    }

    get data() {
      return this._data
    }
  }

  it('shows a saved private image through the resolved link but keeps saving the private URL', async () => {
    const resolve = vi.fn(async () => 'https://signed/pic')
    const Tool = withPrivateDocumentImages(FakeImageTool, resolve)
    const tool = new Tool({ data: { file: { url: PRIVATE } } })

    await vi.waitFor(() => expect(tool.filled).toEqual(['https://signed/pic']))
    expect(resolve).toHaveBeenCalledWith(PRIVATE)
    expect(tool.data.file.url).toBe(PRIVATE)
    expect(tool.ui.nodes.imageContainer.dataset.mutationFree).toBe('true')
  })

  it('resolves private images even when the tool has no image container', async () => {
    const Tool = withPrivateDocumentImages(FakeImageTool, async () => 'https://signed/no-container')
    const tool = new Tool({})
    delete tool.ui.nodes
    tool.image = { url: PRIVATE }
    await vi.waitFor(() => expect(tool.filled).toEqual(['https://signed/no-container']))
    expect(tool.data.file.url).toBe(PRIVATE)
  })

  it('shows ordinary images directly, including after an upload', () => {
    const resolve = vi.fn()
    const Tool = withPrivateDocumentImages(FakeImageTool, resolve)
    const tool = new Tool({})
    tool.image = { url: 'https://example.com/a.png' }
    expect(tool.filled).toEqual(['https://example.com/a.png'])
    expect(resolve).not.toHaveBeenCalled()
  })

  it('leaves the image empty rather than requesting the private URL when a link fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Tool = withPrivateDocumentImages(FakeImageTool, async () => {
      throw new Error('offline')
    })
    const tool = new Tool({ data: { file: { url: PRIVATE } } })
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    expect(tool.filled).toEqual([])
    expect(tool.data.file.url).toBe(PRIVATE)
  })
})
