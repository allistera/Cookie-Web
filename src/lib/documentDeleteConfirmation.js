export function confirmDocumentDelete(document) {
  return window.confirm(
    `Delete document "${document.title || 'Untitled'}"?\n\nThis action cannot be undone.`,
  )
}

export function confirmFolderDelete(folder) {
  return window.confirm(
    `Delete folder "${folder.title}" and its subfolders?\n\nDocuments inside will be moved to Documents. This action cannot be undone.`,
  )
}
