import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FileThumbnail from '../FileThumbnail.vue'
import { thumbnailCache } from '../../lib/fileThumbnails'
import { useDocumentsStore } from '../../stores/documents'

let store
let nextUrl
const revoke = vi.fn()
const drawImage = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  store = useDocumentsStore()
  nextUrl = 0
  // No IntersectionObserver, so thumbnails load as soon as they mount.
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:thumb-${++nextUrl}`),
    revokeObjectURL: revoke,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback, type) {
    callback(new Blob(['small'], { type }))
  })
  vi.spyOn(store, 'fetchFileBlob').mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
})

afterEach(() => {
  thumbnailCache.clear()
  revoke.mockReset()
  drawImage.mockReset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function loadImage(wrapper, width, height) {
  const img = wrapper.get('img')
  Object.defineProperty(img.element, 'naturalWidth', { value: width })
  Object.defineProperty(img.element, 'naturalHeight', { value: height })
  await img.trigger('load')
}

function mountThumbnail() {
  return mount(FileThumbnail, { props: { fileId: 'img-1', mimeType: 'image/png' } })
}

describe('FileThumbnail', () => {
  it('replaces the full-size object URL with a small copy once it has loaded', async () => {
    const wrapper = mountThumbnail()
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:thumb-1')

    await loadImage(wrapper, 4000, 3000)

    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 427, 320)
    expect(revoke).toHaveBeenCalledWith('blob:thumb-1')
    expect(wrapper.get('img').attributes('src')).toBe('blob:thumb-2')
    // Re-entering the folder reuses the small copy without refetching.
    expect(thumbnailCache.get('img-1')).toBe('blob:thumb-2')
    expect(store.fetchFileBlob).toHaveBeenCalledTimes(1)
  })

  it('keeps an image that is already thumbnail-sized', async () => {
    const wrapper = mountThumbnail()
    await flushPromises()

    await loadImage(wrapper, 320, 200)

    expect(drawImage).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    expect(wrapper.get('img').attributes('src')).toBe('blob:thumb-1')
  })

  it('leaves a GIF at full size so it keeps animating', async () => {
    const wrapper = mount(FileThumbnail, { props: { fileId: 'gif-1', mimeType: 'image/gif' } })
    await flushPromises()

    await loadImage(wrapper, 4000, 3000)

    expect(drawImage).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    expect(wrapper.get('img').attributes('src')).toBe('blob:thumb-1')
  })

  it('ignores a stale load after switching to another file', async () => {
    let finishOld
    store.fetchFileBlob
      .mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValue(new Blob(['new']))
    const wrapper = mountThumbnail()
    await flushPromises()

    await wrapper.setProps({ fileId: 'img-2' })
    await flushPromises()
    finishOld(new Blob(['old']))
    await flushPromises()

    expect(wrapper.get('img').attributes('src')).toBe(thumbnailCache.get('img-2'))
  })
})
