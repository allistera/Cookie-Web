import { describe, expect, it, vi } from 'vitest'

import { createThumbnailCache, hasThumbnail } from '../fileThumbnails'

function makeCache(limit) {
  let next = 0
  const revokeUrl = vi.fn()
  const cache = createThumbnailCache({ createUrl: () => `blob:${next++}`, revokeUrl, limit })
  return { cache, revokeUrl }
}

describe('hasThumbnail', () => {
  it('is true only for the sniffed image types', () => {
    expect(hasThumbnail('image/png')).toBe(true)
    expect(hasThumbnail('IMAGE/JPEG')).toBe(true)
    expect(hasThumbnail('application/pdf')).toBe(false)
    expect(hasThumbnail('image/svg+xml')).toBe(false)
    expect(hasThumbnail('')).toBe(false)
    expect(hasThumbnail(undefined)).toBe(false)
  })
})

describe('createThumbnailCache', () => {
  it('returns the same url for a file until it is removed', () => {
    const { cache, revokeUrl } = makeCache(5)
    const url = cache.set('a', new Blob(['a']))
    expect(cache.get('a')).toBe(url)
    cache.remove('a')
    expect(cache.get('a')).toBeUndefined()
    expect(revokeUrl).toHaveBeenCalledWith(url)
  })

  it('evicts and revokes the least recently used url past the limit', () => {
    const { cache, revokeUrl } = makeCache(2)
    const a = cache.set('a', new Blob())
    cache.set('b', new Blob())
    cache.get('a') // a is now the most recent, b the oldest
    cache.set('c', new Blob())
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBe(a)
    expect(cache.get('b')).toBeUndefined()
    expect(revokeUrl).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight fetch and caches the result', async () => {
    const { cache } = makeCache(5)
    const fetchBlob = vi.fn(async () => new Blob())
    const [first, second] = await Promise.all([
      cache.load('a', fetchBlob),
      cache.load('a', fetchBlob),
    ])
    expect(first).toBe(second)
    expect(fetchBlob).toHaveBeenCalledTimes(1)
    await cache.load('a', fetchBlob)
    expect(fetchBlob).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed fetch', async () => {
    const { cache } = makeCache(5)
    const fetchBlob = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Blob())
    await expect(cache.load('a', fetchBlob)).rejects.toThrow('offline')
    expect(cache.get('a')).toBeUndefined()
    await cache.load('a', fetchBlob)
    expect(fetchBlob).toHaveBeenCalledTimes(2)
  })

  it('clear revokes everything', () => {
    const { cache, revokeUrl } = makeCache(5)
    cache.set('a', new Blob())
    cache.set('b', new Blob())
    cache.clear()
    expect(cache.size).toBe(0)
    expect(revokeUrl).toHaveBeenCalledTimes(2)
  })
})
