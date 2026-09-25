export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(event.target.result)
    reader.onerror = (err) => reject(err)
    reader.readAsDataURL(file)
  })
}

// Editor.js image-tool uploader: upload(file) resolves to the stored URL, and
// notify(message, kind) surfaces feedback to the user.
export function createImageUploader(upload, notify) {
  return {
    async uploadByFile(file) {
      // Checked before the try so an oversized image is rejected outright
      // rather than caught and inlined by the base64 fallback below.
      if (file.size > MAX_IMAGE_BYTES) {
        notify('Image is too large — pick a file under 5MB.', 'error')
        throw new Error('File too large')
      }

      try {
        const url = await upload(file)
        return { success: 1, file: { url } }
      } catch (error) {
        console.error('Image upload failed, falling back to base64:', error)
        // Fallback to base64 if blob upload fails
        try {
          const base64Url = await readAsDataUrl(file)
          notify('Using base64 encoding for this image.', 'info')
          return { success: 1, file: { url: base64Url } }
        } catch (fallbackError) {
          console.error('Base64 fallback also failed:', fallbackError)
          notify('Failed to process image. Please try again.', 'error')
          throw fallbackError
        }
      }
    },
    uploadByUrl(url) {
      return Promise.resolve({ success: 1, file: { url } })
    },
  }
}
