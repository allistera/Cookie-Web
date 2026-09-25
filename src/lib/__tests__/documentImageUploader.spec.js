import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_IMAGE_BYTES, createImageUploader } from '../documentImageUploader'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function imageFile(size) {
  return new File([new Uint8Array(size)], 'photo.png', { type: 'image/png' })
}

describe('createImageUploader', () => {
  it('uploads an image within the size limit', async () => {
    const upload = vi.fn().mockResolvedValue('https://blob.example/photo.png')
    const notify = vi.fn()

    const result = await createImageUploader(upload, notify).uploadByFile(imageFile(10))

    expect(result).toEqual({ success: 1, file: { url: 'https://blob.example/photo.png' } })
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects an oversized image instead of inlining it as base64', async () => {
    const upload = vi.fn()
    const notify = vi.fn()

    await expect(
      createImageUploader(upload, notify).uploadByFile(imageFile(MAX_IMAGE_BYTES + 1)),
    ).rejects.toThrow('File too large')

    expect(upload).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Image is too large — pick a file under 5MB.', 'error')
  })

  it('reports a failed upload instead of inlining the image as base64', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('offline'))
    const notify = vi.fn()

    await expect(createImageUploader(upload, notify).uploadByFile(imageFile(10))).rejects.toThrow(
      'offline',
    )

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Image upload failed. Please try again.', 'error')
  })
})
