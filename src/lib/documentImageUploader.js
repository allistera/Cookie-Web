export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Editor.js image-tool uploader: upload(file) resolves to the stored URL, and
// notify(message, kind) surfaces feedback to the user.
//
// A failed upload is reported rather than inlined as a base64 data URL: an
// inlined image (up to ~6.7MB encoded) would be re-sent on every autosave.
export function createImageUploader(upload, notify) {
  return {
    async uploadByFile(file) {
      if (file.size > MAX_IMAGE_BYTES) {
        notify('Image is too large — pick a file under 5MB.', 'error')
        throw new Error('File too large')
      }

      try {
        const url = await upload(file)
        return { success: 1, file: { url } }
      } catch (error) {
        console.error('Image upload failed:', error)
        notify('Image upload failed. Please try again.', 'error')
        throw error
      }
    },
    uploadByUrl(url) {
      return Promise.resolve({ success: 1, file: { url } })
    },
  }
}
