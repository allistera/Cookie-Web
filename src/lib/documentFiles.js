// Pure helpers for the Documents folder browser and uploaded files. No
// store, no DOM: the browser component and the store both lean on these.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const PREVIEWABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
])

export function fileFolderKey(folderId) {
  return folderId ?? 'root'
}

export function isPreviewable(mimeType) {
  return PREVIEWABLE.has(String(mimeType || '').toLowerCase())
}

const KINDS = [
  [/^image\//u, 'Image', 'image'],
  [/^application\/pdf$/u, 'PDF', 'picture_as_pdf'],
  [/spreadsheet|excel|csv/u, 'Spreadsheet', 'table_chart'],
  [/^text\/|word|document|rtf/u, 'Text', 'description'],
  [/zip|tar|gzip|compressed|7z|rar/u, 'Archive', 'folder_zip'],
  [/^audio\//u, 'Audio', 'audio_file'],
  [/^video\//u, 'Video', 'video_file'],
]

function kindEntry(mimeType) {
  const type = String(mimeType || '').toLowerCase()
  return KINDS.find(([pattern]) => pattern.test(type))
}

export function fileKind(mimeType) {
  return kindEntry(mimeType)?.[1] ?? 'File'
}

export function fileIcon(mimeType) {
  return kindEntry(mimeType)?.[2] ?? 'draft'
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

// Folders first by title, then documents and files together by name.
export function folderContents(folders, documents, files, folderId) {
  const here = (row) => (row.folder_id ?? null) === (folderId ?? null)
  const parent = (folder) => (folder.parent_id ?? null) === (folderId ?? null)
  const folderItems = folders
    .filter(parent)
    .map((item) => ({ kind: 'folder', id: item.id, name: item.title, item }))
    .sort(byName)
  const rest = [
    ...documents
      .filter(here)
      .map((item) => ({ kind: 'document', id: item.id, name: item.title || 'Untitled', item })),
    ...files.filter(here).map((item) => ({ kind: 'file', id: item.id, name: item.name, item })),
  ].sort(byName)
  return [...folderItems, ...rest]
}

export function folderBreadcrumb(folders, folderId) {
  const root = { id: null, title: 'Documents' }
  if (!folderId) return [root]
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const trail = []
  let current = byId.get(folderId)
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    trail.unshift({ id: current.id, title: current.title })
    current = current.parent_id ? byId.get(current.parent_id) : null
  }
  return trail.length ? [root, ...trail] : [root]
}
