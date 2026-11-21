// Presentation helpers for attachment chips, shared by the reader's open
// message and the expanded messages of its conversation.

export function attachmentIcon(contentType) {
  if (!contentType) return 'attach_file'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'movie'
  if (contentType.startsWith('audio/')) return 'audiotrack'
  if (contentType === 'application/pdf') return 'picture_as_pdf'
  if (contentType.includes('zip') || contentType.includes('compressed')) return 'folder_zip'
  return 'draft'
}

export function formatFileSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
