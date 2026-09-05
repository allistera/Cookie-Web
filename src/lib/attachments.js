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
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
